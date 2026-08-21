export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      airports: {
        Row: {
          code: string
          lat: number
          lng: number
          city: string
        }
        Insert: {
          code: string
          lat: number
          lng: number
          city: string
        }
        Update: {
          code?: string
          lat?: number
          lng?: number
          city?: string
        }
        Relationships: []
      }
      flights: {
        Row: {
          id: string
          user_id: string
          origin: string
          destination: string
          airline: string
          flight_number: string | null
          flight_date: string
          depart_time: string | null
          arrive_time: string | null
          duration: string | null
          email_url: string | null
          fare_note: string | null
          source: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          origin: string
          destination: string
          airline: string
          flight_number?: string | null
          flight_date: string
          depart_time?: string | null
          arrive_time?: string | null
          duration?: string | null
          email_url?: string | null
          fare_note?: string | null
          source?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          origin?: string
          destination?: string
          airline?: string
          flight_number?: string | null
          flight_date?: string
          depart_time?: string | null
          arrive_time?: string | null
          duration?: string | null
          email_url?: string | null
          fare_note?: string | null
          source?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flights_origin_fkey"
            columns: ["origin"]
            isOneToOne: false
            referencedRelation: "airports"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "flights_destination_fkey"
            columns: ["destination"]
            isOneToOne: false
            referencedRelation: "airports"
            referencedColumns: ["code"]
          },
        ]
      }
      food_map_feed: {
        Row: {
          user_id: string
          feed: Json
          generated_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          feed: Json
          generated_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          feed?: Json
          generated_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      asset_campaigns: {
        Row: {
          asset_id: string
          campaign_id: string
          created_at: string
          id: string
        }
        Insert: {
          asset_id: string
          campaign_id: string
          created_at?: string
          id?: string
        }
        Update: {
          asset_id?: string
          campaign_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_campaigns_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_campaigns_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_tags: {
        Row: {
          asset_id: string
          created_at: string
          id: string
          tag_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          id?: string
          tag_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_tags_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          campaign_id: string
          channel_id: string | null
          file_hash: string | null
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string
          height: number | null
          id: string
          original_file_name: string
          storyboard_id: string | null
          storyboard_order: number | null
          title: string | null
          uploaded_at: string
          uploaded_by: string | null
          width: number | null
        }
        Insert: {
          campaign_id: string
          channel_id?: string | null
          file_hash?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          file_type: string
          height?: number | null
          id?: string
          original_file_name: string
          storyboard_id?: string | null
          storyboard_order?: number | null
          title?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
          width?: number | null
        }
        Update: {
          campaign_id?: string
          channel_id?: string | null
          file_hash?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string
          height?: number | null
          id?: string
          original_file_name?: string
          storyboard_id?: string | null
          storyboard_order?: number | null
          title?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "media_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_storyboard_id_fkey"
            columns: ["storyboard_id"]
            isOneToOne: false
            referencedRelation: "storyboards"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action_type: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json | null
          user_id: string | null
        }
        Insert: {
          action_type: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Update: {
          action_type?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      campaign_channels: {
        Row: {
          campaign_id: string
          channel_id: string
          id: string
        }
        Insert: {
          campaign_id: string
          channel_id: string
          id?: string
        }
        Update: {
          campaign_id?: string
          channel_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_channels_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_channels_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "media_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_members: {
        Row: {
          campaign_id: string
          id: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          id?: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_members_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string | null
          id: string
          is_public: boolean
          name: string
          start_date: string | null
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          is_public?: boolean
          name: string
          start_date?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          is_public?: boolean
          name?: string
          start_date?: string | null
          status?: string
        }
        Relationships: []
      }
      channel_sizes: {
        Row: {
          allowed_extensions: string[] | null
          channel_id: string
          description: string | null
          height: number
          id: string
          max_width: number | null
          width: number
          width_only: boolean
        }
        Insert: {
          allowed_extensions?: string[] | null
          channel_id: string
          description?: string | null
          height: number
          id?: string
          max_width?: number | null
          width: number
          width_only?: boolean
        }
        Update: {
          allowed_extensions?: string[] | null
          channel_id?: string
          description?: string | null
          height?: number
          id?: string
          max_width?: number | null
          width?: number
          width_only?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "channel_sizes_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "media_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      keepalive_pings: {
        Row: {
          id: string
          note: string | null
          pinged_at: string
        }
        Insert: {
          id?: string
          note?: string | null
          pinged_at?: string
        }
        Update: {
          id?: string
          note?: string | null
          pinged_at?: string
        }
        Relationships: []
      }
      media_channels: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      permission_settings: {
        Row: {
          enabled: boolean
          id: string
          permission_key: string
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          id?: string
          permission_key: string
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          id?: string
          permission_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          gender: string
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string
          gender?: string
          id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          gender?: string
          id?: string
        }
        Relationships: []
      }
      sftp_connections: {
        Row: {
          created_at: string
          host: string
          id: string
          is_active: boolean
          last_sync_at: string | null
          name: string
          port: number
          remote_directory: string
          username: string
        }
        Insert: {
          created_at?: string
          host: string
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          name: string
          port?: number
          remote_directory?: string
          username: string
        }
        Update: {
          created_at?: string
          host?: string
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          name?: string
          port?: number
          remote_directory?: string
          username?: string
        }
        Relationships: []
      }
      sftp_files: {
        Row: {
          connection_id: string
          created_at: string
          error_message: string | null
          file_name: string
          file_size: number | null
          file_type: string | null
          id: string
          imported_at: string | null
          imported_to_campaign: string | null
          remote_path: string
          status: string
          storage_path: string | null
          synced_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          error_message?: string | null
          file_name: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          imported_at?: string | null
          imported_to_campaign?: string | null
          remote_path: string
          status?: string
          storage_path?: string | null
          synced_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          error_message?: string | null
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          imported_at?: string | null
          imported_to_campaign?: string | null
          remote_path?: string
          status?: string
          storage_path?: string | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sftp_files_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "sftp_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sftp_files_imported_to_campaign_fkey"
            columns: ["imported_to_campaign"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      storyboards: {
        Row: {
          cover_asset_id: string | null
          created_at: string
          id: string
          name: string
        }
        Insert: {
          cover_asset_id?: string | null
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          cover_asset_id?: string | null
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "storyboards_cover_asset_id_fkey"
            columns: ["cover_asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      tags: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          parent_id: string | null
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          parent_id?: string | null
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          parent_id?: string | null
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
