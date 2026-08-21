import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*';
const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const sftpPassword = Deno.env.get('SFTP_PASSWORD') || ''

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // Authorization: this function runs with verify_jwt = false and uses the
    // service-role key (which bypasses RLS), so we must verify the caller is an
    // authenticated admin before doing any work.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: authData, error: authErr } = await authClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authErr || !authData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', authData.user.id)
      .eq('role', 'admin')
      .maybeSingle()
    if (!roleData) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get active SFTP connections
    const { data: connections, error: connErr } = await supabase
      .from('sftp_connections')
      .select('*')
      .eq('is_active', true)

    if (connErr) throw connErr
    if (!connections || connections.length === 0) {
      return new Response(JSON.stringify({ message: 'No active SFTP connections' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const results: any[] = []

    for (const conn of connections) {
      try {
        // Use SFTP REST proxy or direct connection
        // Since Deno Edge Functions don't natively support SSH/SFTP,
        // we'll use an HTTP-based SFTP gateway. The user will need to 
        // configure SFTP_GATEWAY_URL pointing to their SFTP proxy service.
        const gatewayUrl = Deno.env.get('SFTP_GATEWAY_URL')

        if (!gatewayUrl) {
          // Fallback: mark connection as needing gateway config
          results.push({
            connection: conn.name,
            status: 'error',
            message: 'SFTP_GATEWAY_URL not configured. Set up an SFTP-to-HTTP gateway.',
          })
          continue
        }

        // The SFTP password is transmitted to the gateway, so refuse plaintext HTTP.
        if (!gatewayUrl.startsWith('https://')) {
          results.push({
            connection: conn.name,
            status: 'error',
            message: 'SFTP_GATEWAY_URL must use HTTPS to protect credentials in transit.',
          })
          continue
        }

        // List files from SFTP via gateway
        const listResponse = await fetch(`${gatewayUrl}/list`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: conn.host,
            port: conn.port,
            username: conn.username,
            password: sftpPassword,
            path: conn.remote_directory,
          }),
        })

        if (!listResponse.ok) {
          throw new Error(`Gateway error: ${listResponse.statusText}`)
        }

        const files: Array<{ name: string; size: number; path: string; type: string }> = await listResponse.json()

        // Check which files already exist
        const { data: existingFiles } = await supabase
          .from('sftp_files')
          .select('remote_path')
          .eq('connection_id', conn.id)

        const existingPaths = new Set((existingFiles || []).map((f: any) => f.remote_path))

        let newCount = 0
        for (const file of files) {
          const remotePath = `${conn.remote_directory}/${file.name}`.replace(/\/+/g, '/')
          if (existingPaths.has(remotePath)) continue

          // Download file via gateway
          const downloadResponse = await fetch(`${gatewayUrl}/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              host: conn.host,
              port: conn.port,
              username: conn.username,
              password: sftpPassword,
              path: remotePath,
            }),
          })

          if (!downloadResponse.ok) {
            // Insert as error
            await supabase.from('sftp_files').insert({
              connection_id: conn.id,
              remote_path: remotePath,
              file_name: file.name,
              file_size: file.size,
              file_type: file.type || 'application/octet-stream',
              status: 'error',
              error_message: `Download failed: ${downloadResponse.statusText}`,
            })
            continue
          }

          const fileBlob = await downloadResponse.blob()
          const storagePath = `${conn.id}/${crypto.randomUUID()}_${file.name}`

          // Upload to sftp-imports bucket
          const { error: uploadErr } = await supabase.storage
            .from('sftp-imports')
            .upload(storagePath, fileBlob, {
              contentType: file.type || 'application/octet-stream',
            })

          if (uploadErr) {
            await supabase.from('sftp_files').insert({
              connection_id: conn.id,
              remote_path: remotePath,
              file_name: file.name,
              file_size: file.size,
              file_type: file.type || 'application/octet-stream',
              status: 'error',
              error_message: `Storage upload failed: ${uploadErr.message}`,
            })
            continue
          }

          // Insert as downloaded
          await supabase.from('sftp_files').insert({
            connection_id: conn.id,
            remote_path: remotePath,
            file_name: file.name,
            file_size: file.size,
            file_type: file.type || 'application/octet-stream',
            storage_path: storagePath,
            status: 'downloaded',
          })
          newCount++
        }

        // Update last_sync_at
        await supabase
          .from('sftp_connections')
          .update({ last_sync_at: new Date().toISOString() })
          .eq('id', conn.id)

        results.push({ connection: conn.name, status: 'ok', newFiles: newCount })
      } catch (err) {
        results.push({ connection: conn.name, status: 'error', message: String(err) })
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
