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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      common_deductions: {
        Row: {
          active: boolean
          amount: number
          created_at: string
          id: string
          label: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          amount?: number
          created_at?: string
          id?: string
          label: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          amount?: number
          created_at?: string
          id?: string
          label?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          active: boolean
          created_at: string
          fee_rate_metro: number
          fee_rate_regional: number
          id: string
          issues_invoice: boolean
          name: string
          updated_at: string
          user_id: string
          vat_included: boolean
        }
        Insert: {
          active?: boolean
          created_at?: string
          fee_rate_metro?: number
          fee_rate_regional?: number
          id?: string
          issues_invoice?: boolean
          name: string
          updated_at?: string
          user_id: string
          vat_included?: boolean
        }
        Update: {
          active?: boolean
          created_at?: string
          fee_rate_metro?: number
          fee_rate_regional?: number
          id?: string
          issues_invoice?: boolean
          name?: string
          updated_at?: string
          user_id?: string
          vat_included?: boolean
        }
        Relationships: []
      }
      deliveries: {
        Row: {
          cod_amount: number
          company_id: string | null
          company_name: string
          created_at: string
          customer_name: string | null
          date: string
          id: string
          is_missing: boolean
          item: string | null
          leader1_id: string | null
          leader1_name: string | null
          leader2_id: string | null
          leader2_name: string | null
          leader3_id: string | null
          leader3_name: string | null
          metro_fee: number
          missing_reason: string | null
          note: string | null
          note_amount: number
          paid: boolean
          region: string | null
          region_type: string | null
          regional_fee: number
          split_type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cod_amount?: number
          company_id?: string | null
          company_name: string
          created_at?: string
          customer_name?: string | null
          date: string
          id?: string
          is_missing?: boolean
          item?: string | null
          leader1_id?: string | null
          leader1_name?: string | null
          leader2_id?: string | null
          leader2_name?: string | null
          leader3_id?: string | null
          leader3_name?: string | null
          metro_fee?: number
          missing_reason?: string | null
          note?: string | null
          note_amount?: number
          paid?: boolean
          region?: string | null
          region_type?: string | null
          regional_fee?: number
          split_type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cod_amount?: number
          company_id?: string | null
          company_name?: string
          created_at?: string
          customer_name?: string | null
          date?: string
          id?: string
          is_missing?: boolean
          item?: string | null
          leader1_id?: string | null
          leader1_name?: string | null
          leader2_id?: string | null
          leader2_name?: string | null
          leader3_id?: string | null
          leader3_name?: string | null
          metro_fee?: number
          missing_reason?: string | null
          note?: string | null
          note_amount?: number
          paid?: boolean
          region?: string | null
          region_type?: string | null
          regional_fee?: number
          split_type?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_leader1_id_fkey"
            columns: ["leader1_id"]
            isOneToOne: false
            referencedRelation: "team_leaders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_leader2_id_fkey"
            columns: ["leader2_id"]
            isOneToOne: false
            referencedRelation: "team_leaders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_leader3_id_fkey"
            columns: ["leader3_id"]
            isOneToOne: false
            referencedRelation: "team_leaders"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays: {
        Row: {
          created_at: string
          date: string
          id: string
          note: string | null
          scope: string
          team_leader_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          note?: string | null
          scope: string
          team_leader_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          note?: string | null
          scope?: string
          team_leader_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "holidays_team_leader_id_fkey"
            columns: ["team_leader_id"]
            isOneToOne: false
            referencedRelation: "team_leaders"
            referencedColumns: ["id"]
          },
        ]
      }
      leader_common_overrides: {
        Row: {
          amount: number
          common_deduction_id: string
          created_at: string
          id: string
          leader_id: string
          period_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          common_deduction_id: string
          created_at?: string
          id?: string
          leader_id: string
          period_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          common_deduction_id?: string
          created_at?: string
          id?: string
          leader_id?: string
          period_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      leader_period_deductions: {
        Row: {
          amount: number
          created_at: string
          id: string
          label: string
          leader_id: string
          period_key: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          label?: string
          leader_id: string
          period_key: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          label?: string
          leader_id?: string
          period_key?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      price_list: {
        Row: {
          active: boolean
          cod_default: number
          company_id: string | null
          company_name: string
          created_at: string
          id: string
          item: string | null
          metro_fee: number
          note: string | null
          note_amount: number
          region_detail: string | null
          region_type: string
          regional_fee: number
          spec: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          cod_default?: number
          company_id?: string | null
          company_name: string
          created_at?: string
          id?: string
          item?: string | null
          metro_fee?: number
          note?: string | null
          note_amount?: number
          region_detail?: string | null
          region_type: string
          regional_fee?: number
          spec?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          cod_default?: number
          company_id?: string | null
          company_name?: string
          created_at?: string
          id?: string
          item?: string | null
          metro_fee?: number
          note?: string | null
          note_amount?: number
          region_detail?: string | null
          region_type?: string
          regional_fee?: number
          spec?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      team_leaders: {
        Row: {
          active: boolean
          aliases: string[]
          created_at: string
          deduction_amount: number
          display_suffix: string | null
          id: string
          is_rejected: boolean
          is_virtual: boolean
          name: string
          region: string | null
          settle_to_id: string | null
          trash_cost: number
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          aliases?: string[]
          created_at?: string
          deduction_amount?: number
          display_suffix?: string | null
          id?: string
          is_rejected?: boolean
          is_virtual?: boolean
          name: string
          region?: string | null
          settle_to_id?: string | null
          trash_cost?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          aliases?: string[]
          created_at?: string
          deduction_amount?: number
          display_suffix?: string | null
          id?: string
          is_rejected?: boolean
          is_virtual?: boolean
          name?: string
          region?: string | null
          settle_to_id?: string | null
          trash_cost?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_leaders_settle_to_id_fkey"
            columns: ["settle_to_id"]
            isOneToOne: false
            referencedRelation: "team_leaders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
