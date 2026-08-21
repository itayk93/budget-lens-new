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
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // Verify caller is authenticated
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Importing places files into campaigns, which are admin-managed. Require admin.
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle()
    if (!roleData) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const { fileIds, campaignId, fileMetadata } = body as {
      fileIds: string[]
      campaignId: string
      fileMetadata?: Record<string, { title?: string; channelId?: string; tagIds?: string[] }>
    }

    if (!fileIds?.length || !campaignId) {
      return new Response(JSON.stringify({ error: 'fileIds and campaignId are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get the sftp_files records
    const { data: sftpFiles, error: fetchErr } = await supabase
      .from('sftp_files')
      .select('*')
      .in('id', fileIds)
      .eq('status', 'downloaded')

    if (fetchErr) throw fetchErr
    if (!sftpFiles || sftpFiles.length === 0) {
      return new Response(JSON.stringify({ error: 'No valid files found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const results: any[] = []

    for (const sftpFile of sftpFiles) {
      try {
        // Download from sftp-imports bucket
        const { data: fileData, error: dlErr } = await supabase.storage
          .from('sftp-imports')
          .download(sftpFile.storage_path)

        if (dlErr || !fileData) {
          throw new Error(`Failed to download from staging: ${dlErr?.message}`)
        }

        // Generate unique filename for campaign-assets
        const sanitizedName = sftpFile.file_name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const assetPath = `${campaignId}/${crypto.randomUUID()}_${sanitizedName}`

        // Upload to campaign-assets bucket
        const { error: uploadErr } = await supabase.storage
          .from('campaign-assets')
          .upload(assetPath, fileData, {
            contentType: sftpFile.file_type || 'application/octet-stream',
          })

        if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)

        const meta = fileMetadata?.[sftpFile.id] || {}

        // Create asset record
        const { data: asset, error: assetErr } = await supabase
          .from('assets')
          .insert({
            campaign_id: campaignId,
            file_name: sanitizedName,
            original_file_name: sftpFile.file_name,
            file_path: assetPath,
            file_type: sftpFile.file_type || 'application/octet-stream',
            file_size: sftpFile.file_size,
            title: meta.title || '',
            channel_id: meta.channelId || null,
            uploaded_by: user.id,
          })
          .select()
          .single()

        if (assetErr) throw new Error(`Asset insert failed: ${assetErr.message}`)

        // Create asset_campaigns junction
        await supabase.from('asset_campaigns').insert({
          asset_id: asset.id,
          campaign_id: campaignId,
        })

        // Create asset_tags if provided
        if (meta.tagIds?.length) {
          await supabase.from('asset_tags').insert(
            meta.tagIds.map((tagId: string) => ({
              asset_id: asset.id,
              tag_id: tagId,
            }))
          )
        }

        // Update sftp_file status
        await supabase
          .from('sftp_files')
          .update({
            status: 'imported',
            imported_at: new Date().toISOString(),
            imported_to_campaign: campaignId,
          })
          .eq('id', sftpFile.id)

        // Optionally remove from sftp-imports bucket to save space
        await supabase.storage.from('sftp-imports').remove([sftpFile.storage_path])

        results.push({ id: sftpFile.id, status: 'imported', assetId: asset.id })
      } catch (err) {
        await supabase
          .from('sftp_files')
          .update({ status: 'error', error_message: String(err) })
          .eq('id', sftpFile.id)

        results.push({ id: sftpFile.id, status: 'error', message: String(err) })
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
