import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

type PermissionKey =
  | 'view_campaigns'
  | 'create_campaigns'
  | 'delete_campaigns'
  | 'upload_assets'
  | 'delete_assets'
  | 'view_encyclopedia'
  | 'download_assets'
  | 'share_assets'
  | 'export_pdf'
  | 'view_search'
  | 'edit_campaigns';

interface PermissionsContextType {
  can: (key: PermissionKey) => boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextType | null>(null);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { isAdmin, user } = useAuth();
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const fetchPermissions = useCallback(async () => {
    const { data } = await supabase
      .from('permission_settings')
      .select('permission_key, enabled');
    if (data) {
      const map: Record<string, boolean> = {};
      data.forEach((row: any) => {
        map[row.permission_key] = row.enabled;
      });
      setPermissions(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user) {
      fetchPermissions();
    } else {
      setLoading(false);
    }
  }, [user, fetchPermissions]);

  const can = useCallback(
    (key: PermissionKey): boolean => {
      if (!user) return false;
      if (isAdmin) return true;
      // Campaign management is admin-only (enforced in RLS); never expose these
      // actions to non-admins regardless of permission_settings.
      if (
        key === 'create_campaigns' ||
        key === 'edit_campaigns' ||
        key === 'delete_campaigns' ||
        key === 'delete_assets'
      ) {
        return false;
      }
      return permissions[key] ?? true; // default allow if key missing
    },
    [user, isAdmin, permissions]
  );

  return (
    <PermissionsContext.Provider value={{ can, loading, refresh: fetchPermissions }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions must be used within PermissionsProvider');
  return ctx;
}
