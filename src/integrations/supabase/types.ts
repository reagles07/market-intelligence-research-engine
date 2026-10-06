export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      ai_requests: {
        Row: {
          user_id: string;
          company_id: string | null;
          created_at: string;
          created_by: string | null;
          error: string | null;
          estimated_cost_usd: number;
          id: string;
          input_tokens: number;
          latency_ms: number | null;
          mode: string;
          model: string;
          ok: boolean;
          operation: string;
          output_tokens: number;
          packet_id: string | null;
          provider: string;
          reasoning_tokens: number;
          script_id: string | null;
          story_id: string | null;
          validation_retries: number;
          web_search_calls: number;
        };
        Insert: {
          user_id?: string;
          company_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          error?: string | null;
          estimated_cost_usd?: number;
          id?: string;
          input_tokens?: number;
          latency_ms?: number | null;
          mode?: string;
          model: string;
          ok?: boolean;
          operation: string;
          output_tokens?: number;
          packet_id?: string | null;
          provider?: string;
          reasoning_tokens?: number;
          script_id?: string | null;
          story_id?: string | null;
          validation_retries?: number;
          web_search_calls?: number;
        };
        Update: {
          user_id?: string;
          company_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          error?: string | null;
          estimated_cost_usd?: number;
          id?: string;
          input_tokens?: number;
          latency_ms?: number | null;
          mode?: string;
          model?: string;
          ok?: boolean;
          operation?: string;
          output_tokens?: number;
          packet_id?: string | null;
          provider?: string;
          reasoning_tokens?: number;
          script_id?: string | null;
          story_id?: string | null;
          validation_retries?: number;
          web_search_calls?: number;
        };
        Relationships: [
          {
            foreignKeyName: "ai_requests_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_requests_packet_id_fkey";
            columns: ["packet_id"];
            isOneToOne: false;
            referencedRelation: "research_packets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_requests_script_id_fkey";
            columns: ["script_id"];
            isOneToOne: false;
            referencedRelation: "scripts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_requests_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      analyst_views: {
        Row: {
          user_id: string;
          analyst: string | null;
          company_id: string | null;
          created_at: string;
          created_by: string | null;
          currency: string | null;
          firm: string;
          id: string;
          is_stale: boolean;
          previous_price_target: number | null;
          price_target: number | null;
          rating: string | null;
          rationale: string | null;
          source_id: string | null;
          story_id: string | null;
          updated_at: string;
          view_date: string | null;
        };
        Insert: {
          user_id?: string;
          analyst?: string | null;
          company_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string | null;
          firm: string;
          id?: string;
          is_stale?: boolean;
          previous_price_target?: number | null;
          price_target?: number | null;
          rating?: string | null;
          rationale?: string | null;
          source_id?: string | null;
          story_id?: string | null;
          updated_at?: string;
          view_date?: string | null;
        };
        Update: {
          user_id?: string;
          analyst?: string | null;
          company_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string | null;
          firm?: string;
          id?: string;
          is_stale?: boolean;
          previous_price_target?: number | null;
          price_target?: number | null;
          rating?: string | null;
          rationale?: string | null;
          source_id?: string | null;
          story_id?: string | null;
          updated_at?: string;
          view_date?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "analyst_views_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "analyst_views_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "sources";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "analyst_views_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          user_id: string;
          action: string;
          created_at: string;
          entity: string | null;
          entity_id: string | null;
          id: string;
          meta: Json;
        };
        Insert: {
          user_id?: string;
          action: string;
          created_at?: string;
          entity?: string | null;
          entity_id?: string | null;
          id?: string;
          meta?: Json;
        };
        Update: {
          user_id?: string;
          action?: string;
          created_at?: string;
          entity?: string | null;
          entity_id?: string | null;
          id?: string;
          meta?: Json;
        };
        Relationships: [];
      };
      automation_pipeline_items: {
        Row: {
          user_id: string;
          ai_calls: number;
          candidate_id: string | null;
          company_name: string;
          completed_at: string | null;
          content_readiness: string | null;
          content_run_id: string | null;
          content_score: number;
          created_at: string;
          detail: Json;
          estimated_cost_usd: number;
          gaps_detected: number;
          gaps_resolved: number;
          id: string;
          market: string;
          outcome: string;
          pipeline_run_id: string;
          rank_index: number;
          research_readiness: string | null;
          research_run_id: string | null;
          score_coverage_pct: number;
          skip_reason: string | null;
          stage: string;
          started_at: string;
          story_id: string | null;
          ticker: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          ai_calls?: number;
          candidate_id?: string | null;
          company_name?: string;
          completed_at?: string | null;
          content_readiness?: string | null;
          content_run_id?: string | null;
          content_score?: number;
          created_at?: string;
          detail?: Json;
          estimated_cost_usd?: number;
          gaps_detected?: number;
          gaps_resolved?: number;
          id?: string;
          market: string;
          outcome?: string;
          pipeline_run_id: string;
          rank_index?: number;
          research_readiness?: string | null;
          research_run_id?: string | null;
          score_coverage_pct?: number;
          skip_reason?: string | null;
          stage?: string;
          started_at?: string;
          story_id?: string | null;
          ticker?: string | null;
          title?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          ai_calls?: number;
          candidate_id?: string | null;
          company_name?: string;
          completed_at?: string | null;
          content_readiness?: string | null;
          content_run_id?: string | null;
          content_score?: number;
          created_at?: string;
          detail?: Json;
          estimated_cost_usd?: number;
          gaps_detected?: number;
          gaps_resolved?: number;
          id?: string;
          market?: string;
          outcome?: string;
          pipeline_run_id?: string;
          rank_index?: number;
          research_readiness?: string | null;
          research_run_id?: string | null;
          score_coverage_pct?: number;
          skip_reason?: string | null;
          stage?: string;
          started_at?: string;
          story_id?: string | null;
          ticker?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "automation_pipeline_items_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "story_candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automation_pipeline_items_content_run_id_fkey";
            columns: ["content_run_id"];
            isOneToOne: false;
            referencedRelation: "content_orchestration_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automation_pipeline_items_pipeline_run_id_fkey";
            columns: ["pipeline_run_id"];
            isOneToOne: false;
            referencedRelation: "automation_pipeline_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automation_pipeline_items_research_run_id_fkey";
            columns: ["research_run_id"];
            isOneToOne: false;
            referencedRelation: "research_orchestration_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automation_pipeline_items_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      automation_pipeline_runs: {
        Row: {
          user_id: string;
          ai_calls: number;
          autonomous_budget_usd: number;
          candidates_considered: number;
          candidates_qualified: number;
          completed_at: string | null;
          content_runs: number;
          created_at: string;
          created_by: string | null;
          daily_run_id: string | null;
          discovery_run_id: string | null;
          dry_run: boolean;
          errors: Json;
          estimated_cost_usd: number;
          execution_id: string | null;
          execution_type: string;
          id: string;
          market: string;
          market_date: string;
          needs_attention: number;
          plan: Json;
          provider_calls: number;
          ready_for_review: number;
          research_ready: number;
          research_runs: number;
          skip_reason: string | null;
          started_at: string;
          status: string;
          stories_promoted: number;
          trigger: string;
          updated_at: string;
          warnings: Json;
          web_searches: number;
        };
        Insert: {
          user_id?: string;
          ai_calls?: number;
          autonomous_budget_usd?: number;
          candidates_considered?: number;
          candidates_qualified?: number;
          completed_at?: string | null;
          content_runs?: number;
          created_at?: string;
          created_by?: string | null;
          daily_run_id?: string | null;
          discovery_run_id?: string | null;
          dry_run?: boolean;
          errors?: Json;
          estimated_cost_usd?: number;
          execution_id?: string | null;
          execution_type?: string;
          id?: string;
          market: string;
          market_date: string;
          needs_attention?: number;
          plan?: Json;
          provider_calls?: number;
          ready_for_review?: number;
          research_ready?: number;
          research_runs?: number;
          skip_reason?: string | null;
          started_at?: string;
          status?: string;
          stories_promoted?: number;
          trigger?: string;
          updated_at?: string;
          warnings?: Json;
          web_searches?: number;
        };
        Update: {
          user_id?: string;
          ai_calls?: number;
          autonomous_budget_usd?: number;
          candidates_considered?: number;
          candidates_qualified?: number;
          completed_at?: string | null;
          content_runs?: number;
          created_at?: string;
          created_by?: string | null;
          daily_run_id?: string | null;
          discovery_run_id?: string | null;
          dry_run?: boolean;
          errors?: Json;
          estimated_cost_usd?: number;
          execution_id?: string | null;
          execution_type?: string;
          id?: string;
          market?: string;
          market_date?: string;
          needs_attention?: number;
          plan?: Json;
          provider_calls?: number;
          ready_for_review?: number;
          research_ready?: number;
          research_runs?: number;
          skip_reason?: string | null;
          started_at?: string;
          status?: string;
          stories_promoted?: number;
          trigger?: string;
          updated_at?: string;
          warnings?: Json;
          web_searches?: number;
        };
        Relationships: [
          {
            foreignKeyName: "automation_pipeline_runs_daily_run_id_fkey";
            columns: ["daily_run_id"];
            isOneToOne: false;
            referencedRelation: "daily_market_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automation_pipeline_runs_discovery_run_id_fkey";
            columns: ["discovery_run_id"];
            isOneToOne: false;
            referencedRelation: "discovery_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automation_pipeline_runs_execution_id_fkey";
            columns: ["execution_id"];
            isOneToOne: false;
            referencedRelation: "daily_run_executions";
            referencedColumns: ["id"];
          },
        ];
      };
      automation_settings: {
        Row: {
          user_id: string;
          ai_daily_cost_cap_usd: number;
          ai_monthly_cost_cap_usd: number;
          automation_enabled: boolean;
          autonomous_ai_budget_percent: number;
          autonomous_enabled: boolean;
          autonomous_long_enabled: boolean;
          autonomous_long_min_score: number;
          autonomous_short_duration: string;
          catchup_window_minutes: number;
          created_at: string;
          created_by: string | null;
          daily_web_search_cap: number;
          dry_run: boolean;
          high_priority_delta_threshold: number;
          id: string;
          india_enabled: boolean;
          indianapi_monthly_reserve: number;
          lock_ttl_minutes: number;
          max_content_delta: number;
          max_content_main: number;
          max_research_delta: number;
          max_research_main: number;
          max_retries: number;
          min_content_score_india: number;
          min_content_score_us: number;
          min_score_coverage_india: number;
          min_score_coverage_us: number;
          singleton: boolean;
          stuck_after_minutes: number;
          updated_at: string;
          us_enabled: boolean;
        };
        Insert: {
          user_id?: string;
          ai_daily_cost_cap_usd?: number;
          ai_monthly_cost_cap_usd?: number;
          automation_enabled?: boolean;
          autonomous_ai_budget_percent?: number;
          autonomous_enabled?: boolean;
          autonomous_long_enabled?: boolean;
          autonomous_long_min_score?: number;
          autonomous_short_duration?: string;
          catchup_window_minutes?: number;
          created_at?: string;
          created_by?: string | null;
          daily_web_search_cap?: number;
          dry_run?: boolean;
          high_priority_delta_threshold?: number;
          id?: string;
          india_enabled?: boolean;
          indianapi_monthly_reserve?: number;
          lock_ttl_minutes?: number;
          max_content_delta?: number;
          max_content_main?: number;
          max_research_delta?: number;
          max_research_main?: number;
          max_retries?: number;
          min_content_score_india?: number;
          min_content_score_us?: number;
          min_score_coverage_india?: number;
          min_score_coverage_us?: number;
          singleton?: boolean;
          stuck_after_minutes?: number;
          updated_at?: string;
          us_enabled?: boolean;
        };
        Update: {
          user_id?: string;
          ai_daily_cost_cap_usd?: number;
          ai_monthly_cost_cap_usd?: number;
          automation_enabled?: boolean;
          autonomous_ai_budget_percent?: number;
          autonomous_enabled?: boolean;
          autonomous_long_enabled?: boolean;
          autonomous_long_min_score?: number;
          autonomous_short_duration?: string;
          catchup_window_minutes?: number;
          created_at?: string;
          created_by?: string | null;
          daily_web_search_cap?: number;
          dry_run?: boolean;
          high_priority_delta_threshold?: number;
          id?: string;
          india_enabled?: boolean;
          indianapi_monthly_reserve?: number;
          lock_ttl_minutes?: number;
          max_content_delta?: number;
          max_content_main?: number;
          max_research_delta?: number;
          max_research_main?: number;
          max_retries?: number;
          min_content_score_india?: number;
          min_content_score_us?: number;
          min_score_coverage_india?: number;
          min_score_coverage_us?: number;
          singleton?: boolean;
          stuck_after_minutes?: number;
          updated_at?: string;
          us_enabled?: boolean;
        };
        Relationships: [];
      };
      candidate_score_components: {
        Row: {
          user_id: string;
          available: boolean;
          candidate_id: string;
          component_key: string;
          created_at: string;
          id: string;
          label: string;
          max_points: number;
          points: number;
          reason: string;
          stage: string;
          value_text: string | null;
        };
        Insert: {
          user_id?: string;
          available?: boolean;
          candidate_id: string;
          component_key: string;
          created_at?: string;
          id?: string;
          label: string;
          max_points: number;
          points?: number;
          reason?: string;
          stage?: string;
          value_text?: string | null;
        };
        Update: {
          user_id?: string;
          available?: boolean;
          candidate_id?: string;
          component_key?: string;
          created_at?: string;
          id?: string;
          label?: string;
          max_points?: number;
          points?: number;
          reason?: string;
          stage?: string;
          value_text?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "candidate_score_components_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "story_candidates";
            referencedColumns: ["id"];
          },
        ];
      };
      candidate_sources: {
        Row: {
          user_id: string;
          candidate_id: string;
          canonical_url: string | null;
          created_at: string;
          created_by: string | null;
          endpoint: string | null;
          id: string;
          provider: string;
          published_at: string | null;
          publisher: string | null;
          raw_response_id: string | null;
          signal_type: string | null;
          source_id: string | null;
          source_tier: string;
          source_type: string;
          title: string | null;
          url: string | null;
        };
        Insert: {
          user_id?: string;
          candidate_id: string;
          canonical_url?: string | null;
          created_at?: string;
          created_by?: string | null;
          endpoint?: string | null;
          id?: string;
          provider: string;
          published_at?: string | null;
          publisher?: string | null;
          raw_response_id?: string | null;
          signal_type?: string | null;
          source_id?: string | null;
          source_tier?: string;
          source_type?: string;
          title?: string | null;
          url?: string | null;
        };
        Update: {
          user_id?: string;
          candidate_id?: string;
          canonical_url?: string | null;
          created_at?: string;
          created_by?: string | null;
          endpoint?: string | null;
          id?: string;
          provider?: string;
          published_at?: string | null;
          publisher?: string | null;
          raw_response_id?: string | null;
          signal_type?: string | null;
          source_id?: string | null;
          source_tier?: string;
          source_type?: string;
          title?: string | null;
          url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "candidate_sources_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "story_candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_sources_raw_response_id_fkey";
            columns: ["raw_response_id"];
            isOneToOne: false;
            referencedRelation: "provider_raw_responses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_sources_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "sources";
            referencedColumns: ["id"];
          },
        ];
      };
      claims: {
        Row: {
          user_id: string;
          claim_category: string;
          claim_text: string;
          company_id: string | null;
          confidence: number | null;
          created_at: string;
          created_by: string | null;
          evidence_accession: string | null;
          evidence_detail: Json;
          evidence_metric_keys: string[];
          evidence_period: string | null;
          evidence_provider: string | null;
          evidence_type: string;
          financial_period_id: string | null;
          id: string;
          is_critical: boolean;
          notes: string | null;
          reporting_period: string | null;
          sec_fact_id: string | null;
          sec_filing_id: string | null;
          source_id: string | null;
          story_id: string | null;
          unit: string | null;
          updated_at: string;
          value: string | null;
          verification_status: string;
        };
        Insert: {
          user_id?: string;
          claim_category?: string;
          claim_text: string;
          company_id?: string | null;
          confidence?: number | null;
          created_at?: string;
          created_by?: string | null;
          evidence_accession?: string | null;
          evidence_detail?: Json;
          evidence_metric_keys?: string[];
          evidence_period?: string | null;
          evidence_provider?: string | null;
          evidence_type?: string;
          financial_period_id?: string | null;
          id?: string;
          is_critical?: boolean;
          notes?: string | null;
          reporting_period?: string | null;
          sec_fact_id?: string | null;
          sec_filing_id?: string | null;
          source_id?: string | null;
          story_id?: string | null;
          unit?: string | null;
          updated_at?: string;
          value?: string | null;
          verification_status?: string;
        };
        Update: {
          user_id?: string;
          claim_category?: string;
          claim_text?: string;
          company_id?: string | null;
          confidence?: number | null;
          created_at?: string;
          created_by?: string | null;
          evidence_accession?: string | null;
          evidence_detail?: Json;
          evidence_metric_keys?: string[];
          evidence_period?: string | null;
          evidence_provider?: string | null;
          evidence_type?: string;
          financial_period_id?: string | null;
          id?: string;
          is_critical?: boolean;
          notes?: string | null;
          reporting_period?: string | null;
          sec_fact_id?: string | null;
          sec_filing_id?: string | null;
          source_id?: string | null;
          story_id?: string | null;
          unit?: string | null;
          updated_at?: string;
          value?: string | null;
          verification_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "claims_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_financial_period_id_fkey";
            columns: ["financial_period_id"];
            isOneToOne: false;
            referencedRelation: "financial_periods";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_sec_fact_id_fkey";
            columns: ["sec_fact_id"];
            isOneToOne: false;
            referencedRelation: "sec_facts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_sec_filing_id_fkey";
            columns: ["sec_filing_id"];
            isOneToOne: false;
            referencedRelation: "sec_filings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "sources";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      companies: {
        Row: {
          user_id: string;
          business_model: Json;
          country: string;
          created_at: string;
          created_by: string | null;
          currency: string;
          data_mode: string;
          description: string | null;
          exchange: string;
          id: string;
          industry: string | null;
          ir_url: string | null;
          is_active: boolean;
          is_demo: boolean;
          logo_url: string | null;
          market_cap: number | null;
          moat_categories: string[];
          moat_evidence: string | null;
          moat_explanation: string | null;
          moat_strength: number | null;
          name: string;
          peers: string[];
          primary_index: string | null;
          sec_cik: string | null;
          sec_last_sync: string | null;
          sec_status: string;
          sector: string | null;
          ticker: string;
          updated_at: string;
          website: string | null;
        };
        Insert: {
          user_id?: string;
          business_model?: Json;
          country?: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          data_mode?: string;
          description?: string | null;
          exchange: string;
          id?: string;
          industry?: string | null;
          ir_url?: string | null;
          is_active?: boolean;
          is_demo?: boolean;
          logo_url?: string | null;
          market_cap?: number | null;
          moat_categories?: string[];
          moat_evidence?: string | null;
          moat_explanation?: string | null;
          moat_strength?: number | null;
          name: string;
          peers?: string[];
          primary_index?: string | null;
          sec_cik?: string | null;
          sec_last_sync?: string | null;
          sec_status?: string;
          sector?: string | null;
          ticker: string;
          updated_at?: string;
          website?: string | null;
        };
        Update: {
          user_id?: string;
          business_model?: Json;
          country?: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          data_mode?: string;
          description?: string | null;
          exchange?: string;
          id?: string;
          industry?: string | null;
          ir_url?: string | null;
          is_active?: boolean;
          is_demo?: boolean;
          logo_url?: string | null;
          market_cap?: number | null;
          moat_categories?: string[];
          moat_evidence?: string | null;
          moat_explanation?: string | null;
          moat_strength?: number | null;
          name?: string;
          peers?: string[];
          primary_index?: string | null;
          sec_cik?: string | null;
          sec_last_sync?: string | null;
          sec_status?: string;
          sector?: string | null;
          ticker?: string;
          updated_at?: string;
          website?: string | null;
        };
        Relationships: [];
      };
      content_assets: {
        Row: {
          user_id: string;
          asset_type: string;
          company_id: string | null;
          content: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          packet_id: string | null;
          packet_version: number | null;
          payload: Json;
          script_id: string | null;
          story_id: string | null;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          asset_type: string;
          company_id?: string | null;
          content?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          packet_id?: string | null;
          packet_version?: number | null;
          payload?: Json;
          script_id?: string | null;
          story_id?: string | null;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          asset_type?: string;
          company_id?: string | null;
          content?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          packet_id?: string | null;
          packet_version?: number | null;
          payload?: Json;
          script_id?: string | null;
          story_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_assets_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_assets_packet_id_fkey";
            columns: ["packet_id"];
            isOneToOne: false;
            referencedRelation: "research_packets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_assets_script_id_fkey";
            columns: ["script_id"];
            isOneToOne: false;
            referencedRelation: "scripts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_assets_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      content_composition_companies: {
        Row: {
          user_id: string;
          company_id: string;
          composition_id: string;
          created_at: string;
          eligible: boolean;
          id: string;
          ineligible_reason: string | null;
          order_index: number;
          packet_id: string | null;
          packet_version: number | null;
          readiness: string | null;
          short_count: number;
          story_id: string | null;
        };
        Insert: {
          user_id?: string;
          company_id: string;
          composition_id: string;
          created_at?: string;
          eligible?: boolean;
          id?: string;
          ineligible_reason?: string | null;
          order_index?: number;
          packet_id?: string | null;
          packet_version?: number | null;
          readiness?: string | null;
          short_count?: number;
          story_id?: string | null;
        };
        Update: {
          user_id?: string;
          company_id?: string;
          composition_id?: string;
          created_at?: string;
          eligible?: boolean;
          id?: string;
          ineligible_reason?: string | null;
          order_index?: number;
          packet_id?: string | null;
          packet_version?: number | null;
          readiness?: string | null;
          short_count?: number;
          story_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "content_composition_companies_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_composition_companies_composition_id_fkey";
            columns: ["composition_id"];
            isOneToOne: false;
            referencedRelation: "content_compositions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_composition_companies_packet_id_fkey";
            columns: ["packet_id"];
            isOneToOne: false;
            referencedRelation: "research_packets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_composition_companies_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      content_compositions: {
        Row: {
          user_id: string;
          allow_ranking: boolean;
          auto_allocate: boolean;
          combined_shorts: number;
          created_at: string;
          created_by: string | null;
          creator_instruction: string | null;
          custom_duration_minutes: number | null;
          estimated_scripts: number;
          id: string;
          language: string;
          long_enabled: boolean;
          mode: string;
          pack_key: string | null;
          platform: string;
          result: Json;
          short_allocation: Json;
          shorts_enabled: boolean;
          status: string;
          target_duration: string | null;
          theme: string | null;
          title: string | null;
          tone: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          allow_ranking?: boolean;
          auto_allocate?: boolean;
          combined_shorts?: number;
          created_at?: string;
          created_by?: string | null;
          creator_instruction?: string | null;
          custom_duration_minutes?: number | null;
          estimated_scripts?: number;
          id?: string;
          language?: string;
          long_enabled?: boolean;
          mode?: string;
          pack_key?: string | null;
          platform?: string;
          result?: Json;
          short_allocation?: Json;
          shorts_enabled?: boolean;
          status?: string;
          target_duration?: string | null;
          theme?: string | null;
          title?: string | null;
          tone?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          allow_ranking?: boolean;
          auto_allocate?: boolean;
          combined_shorts?: number;
          created_at?: string;
          created_by?: string | null;
          creator_instruction?: string | null;
          custom_duration_minutes?: number | null;
          estimated_scripts?: number;
          id?: string;
          language?: string;
          long_enabled?: boolean;
          mode?: string;
          pack_key?: string | null;
          platform?: string;
          result?: Json;
          short_allocation?: Json;
          shorts_enabled?: boolean;
          status?: string;
          target_duration?: string | null;
          theme?: string | null;
          title?: string | null;
          tone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      content_orchestration_runs: {
        Row: {
          user_id: string;
          ai_calls: number;
          audit_summary: Json;
          cache_hit: boolean;
          company_id: string | null;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          current_step: string | null;
          errors: Json;
          estimated_cost_usd: number;
          formats: Json;
          gaps: Json;
          gaps_resolved: number;
          gaps_unresolved: number;
          id: string;
          input_tokens: number;
          long_script_id: string | null;
          market: string | null;
          output_tokens: number;
          packet_id: string | null;
          packet_version: number | null;
          readiness: string | null;
          readiness_reason: string | null;
          readiness_summary: Json;
          repairs_run: number;
          request_key: string | null;
          reused_run_id: string | null;
          scripts_generated: number;
          short_script_ids: Json;
          started_at: string;
          status: string;
          story_id: string;
          style_profile_id: string | null;
          style_profile_version: number | null;
          trigger_source: string;
          updated_at: string;
          warnings: Json;
          word_counts: Json;
        };
        Insert: {
          user_id?: string;
          ai_calls?: number;
          audit_summary?: Json;
          cache_hit?: boolean;
          company_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_step?: string | null;
          errors?: Json;
          estimated_cost_usd?: number;
          formats?: Json;
          gaps?: Json;
          gaps_resolved?: number;
          gaps_unresolved?: number;
          id?: string;
          input_tokens?: number;
          long_script_id?: string | null;
          market?: string | null;
          output_tokens?: number;
          packet_id?: string | null;
          packet_version?: number | null;
          readiness?: string | null;
          readiness_reason?: string | null;
          readiness_summary?: Json;
          repairs_run?: number;
          request_key?: string | null;
          reused_run_id?: string | null;
          scripts_generated?: number;
          short_script_ids?: Json;
          started_at?: string;
          status?: string;
          story_id: string;
          style_profile_id?: string | null;
          style_profile_version?: number | null;
          trigger_source?: string;
          updated_at?: string;
          warnings?: Json;
          word_counts?: Json;
        };
        Update: {
          user_id?: string;
          ai_calls?: number;
          audit_summary?: Json;
          cache_hit?: boolean;
          company_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_step?: string | null;
          errors?: Json;
          estimated_cost_usd?: number;
          formats?: Json;
          gaps?: Json;
          gaps_resolved?: number;
          gaps_unresolved?: number;
          id?: string;
          input_tokens?: number;
          long_script_id?: string | null;
          market?: string | null;
          output_tokens?: number;
          packet_id?: string | null;
          packet_version?: number | null;
          readiness?: string | null;
          readiness_reason?: string | null;
          readiness_summary?: Json;
          repairs_run?: number;
          request_key?: string | null;
          reused_run_id?: string | null;
          scripts_generated?: number;
          short_script_ids?: Json;
          started_at?: string;
          status?: string;
          story_id?: string;
          style_profile_id?: string | null;
          style_profile_version?: number | null;
          trigger_source?: string;
          updated_at?: string;
          warnings?: Json;
          word_counts?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "content_orchestration_runs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_orchestration_runs_long_script_id_fkey";
            columns: ["long_script_id"];
            isOneToOne: false;
            referencedRelation: "scripts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_orchestration_runs_packet_id_fkey";
            columns: ["packet_id"];
            isOneToOne: false;
            referencedRelation: "research_packets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_orchestration_runs_reused_run_id_fkey";
            columns: ["reused_run_id"];
            isOneToOne: false;
            referencedRelation: "content_orchestration_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_orchestration_runs_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      content_orchestration_steps: {
        Row: {
          user_id: string;
          ai_calls: number;
          completed_at: string | null;
          created_at: string;
          detail: Json;
          error: string | null;
          estimated_cost_usd: number;
          id: string;
          label: string;
          order_index: number;
          run_id: string;
          started_at: string | null;
          status: string;
          step_key: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          ai_calls?: number;
          completed_at?: string | null;
          created_at?: string;
          detail?: Json;
          error?: string | null;
          estimated_cost_usd?: number;
          id?: string;
          label: string;
          order_index?: number;
          run_id: string;
          started_at?: string | null;
          status?: string;
          step_key: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          ai_calls?: number;
          completed_at?: string | null;
          created_at?: string;
          detail?: Json;
          error?: string | null;
          estimated_cost_usd?: number;
          id?: string;
          label?: string;
          order_index?: number;
          run_id?: string;
          started_at?: string | null;
          status?: string;
          step_key?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_orchestration_steps_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "content_orchestration_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      content_publications: {
        Row: {
          user_id: string;
          content_asset_id: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          platform: string;
          published_at: string | null;
          script_id: string | null;
          status: string;
          updated_at: string;
          url: string | null;
        };
        Insert: {
          user_id?: string;
          content_asset_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          platform?: string;
          published_at?: string | null;
          script_id?: string | null;
          status?: string;
          updated_at?: string;
          url?: string | null;
        };
        Update: {
          user_id?: string;
          content_asset_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          platform?: string;
          published_at?: string | null;
          script_id?: string | null;
          status?: string;
          updated_at?: string;
          url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "content_publications_content_asset_id_fkey";
            columns: ["content_asset_id"];
            isOneToOne: false;
            referencedRelation: "content_assets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_publications_script_id_fkey";
            columns: ["script_id"];
            isOneToOne: false;
            referencedRelation: "scripts";
            referencedColumns: ["id"];
          },
        ];
      };
      daily_market_runs: {
        Row: {
          user_id: string;
          ai_calls: number;
          candidate_count: number;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          delta_run_status: string | null;
          errors: Json;
          estimated_cost_usd: number;
          id: string;
          input_tokens: number;
          main_run_status: string | null;
          market: string;
          market_date: string;
          market_open_decision: string | null;
          output_tokens: number;
          provider_calls: number;
          raw_signal_count: number;
          shortlisted_count: number;
          started_at: string | null;
          status: string;
          timezone: string;
          top_score: number | null;
          updated_at: string;
          warnings: Json;
          web_searches: number;
        };
        Insert: {
          user_id?: string;
          ai_calls?: number;
          candidate_count?: number;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          delta_run_status?: string | null;
          errors?: Json;
          estimated_cost_usd?: number;
          id?: string;
          input_tokens?: number;
          main_run_status?: string | null;
          market: string;
          market_date: string;
          market_open_decision?: string | null;
          output_tokens?: number;
          provider_calls?: number;
          raw_signal_count?: number;
          shortlisted_count?: number;
          started_at?: string | null;
          status?: string;
          timezone: string;
          top_score?: number | null;
          updated_at?: string;
          warnings?: Json;
          web_searches?: number;
        };
        Update: {
          user_id?: string;
          ai_calls?: number;
          candidate_count?: number;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          delta_run_status?: string | null;
          errors?: Json;
          estimated_cost_usd?: number;
          id?: string;
          input_tokens?: number;
          main_run_status?: string | null;
          market?: string;
          market_date?: string;
          market_open_decision?: string | null;
          output_tokens?: number;
          provider_calls?: number;
          raw_signal_count?: number;
          shortlisted_count?: number;
          started_at?: string | null;
          status?: string;
          timezone?: string;
          top_score?: number | null;
          updated_at?: string;
          warnings?: Json;
          web_searches?: number;
        };
        Relationships: [];
      };
      daily_run_executions: {
        Row: {
          user_id: string;
          ai_calls: number;
          attempt: number;
          baseline_execution_id: string | null;
          cancel_requested: boolean;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          daily_run_id: string;
          discovery_run_id: string | null;
          dry_run: boolean;
          duplicate_candidates: number;
          error: string | null;
          estimated_cost_usd: number;
          execution_key: string;
          execution_type: string;
          heartbeat_at: string | null;
          high_priority_candidates: number;
          id: string;
          input_tokens: number;
          lateness_minutes: number | null;
          market: string;
          market_date: string;
          new_candidates: number;
          output_tokens: number;
          plan: Json;
          provider_calls: number;
          raw_signal_count: number;
          scheduled_for: string | null;
          skip_reason: string | null;
          started_at: string;
          status: string;
          steps: Json;
          top_score: number | null;
          trigger: string;
          triggered_at: string;
          unchanged_candidates: number;
          updated_at: string;
          updated_candidates: number;
          warnings: Json;
          web_searches: number;
        };
        Insert: {
          user_id?: string;
          ai_calls?: number;
          attempt?: number;
          baseline_execution_id?: string | null;
          cancel_requested?: boolean;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          daily_run_id: string;
          discovery_run_id?: string | null;
          dry_run?: boolean;
          duplicate_candidates?: number;
          error?: string | null;
          estimated_cost_usd?: number;
          execution_key: string;
          execution_type: string;
          heartbeat_at?: string | null;
          high_priority_candidates?: number;
          id?: string;
          input_tokens?: number;
          lateness_minutes?: number | null;
          market: string;
          market_date: string;
          new_candidates?: number;
          output_tokens?: number;
          plan?: Json;
          provider_calls?: number;
          raw_signal_count?: number;
          scheduled_for?: string | null;
          skip_reason?: string | null;
          started_at?: string;
          status?: string;
          steps?: Json;
          top_score?: number | null;
          trigger?: string;
          triggered_at?: string;
          unchanged_candidates?: number;
          updated_at?: string;
          updated_candidates?: number;
          warnings?: Json;
          web_searches?: number;
        };
        Update: {
          user_id?: string;
          ai_calls?: number;
          attempt?: number;
          baseline_execution_id?: string | null;
          cancel_requested?: boolean;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          daily_run_id?: string;
          discovery_run_id?: string | null;
          dry_run?: boolean;
          duplicate_candidates?: number;
          error?: string | null;
          estimated_cost_usd?: number;
          execution_key?: string;
          execution_type?: string;
          heartbeat_at?: string | null;
          high_priority_candidates?: number;
          id?: string;
          input_tokens?: number;
          lateness_minutes?: number | null;
          market?: string;
          market_date?: string;
          new_candidates?: number;
          output_tokens?: number;
          plan?: Json;
          provider_calls?: number;
          raw_signal_count?: number;
          scheduled_for?: string | null;
          skip_reason?: string | null;
          started_at?: string;
          status?: string;
          steps?: Json;
          top_score?: number | null;
          trigger?: string;
          triggered_at?: string;
          unchanged_candidates?: number;
          updated_at?: string;
          updated_candidates?: number;
          warnings?: Json;
          web_searches?: number;
        };
        Relationships: [
          {
            foreignKeyName: "daily_run_executions_daily_run_id_fkey";
            columns: ["daily_run_id"];
            isOneToOne: false;
            referencedRelation: "daily_market_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_run_executions_discovery_run_id_fkey";
            columns: ["discovery_run_id"];
            isOneToOne: false;
            referencedRelation: "discovery_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      discovery_runs: {
        Row: {
          user_id: string;
          ai_calls: number;
          candidates_created: number;
          clustered_duplicates: number;
          completed_at: string | null;
          coverage: string;
          created_at: string;
          created_by: string | null;
          errors: Json;
          estimated_cost_usd: number;
          evaluated: number;
          id: string;
          input_tokens: number;
          market: string;
          notes: string | null;
          output_tokens: number;
          provider_endpoints: Json;
          provider_request_budget: number;
          provider_requests: number;
          raw_signals: number;
          run_type: string;
          shortlisted: number;
          started_at: string;
          status: string;
          updated_at: string;
          web_search_budget: number;
          web_search_calls: number;
          web_search_queries: Json;
        };
        Insert: {
          user_id?: string;
          ai_calls?: number;
          candidates_created?: number;
          clustered_duplicates?: number;
          completed_at?: string | null;
          coverage?: string;
          created_at?: string;
          created_by?: string | null;
          errors?: Json;
          estimated_cost_usd?: number;
          evaluated?: number;
          id?: string;
          input_tokens?: number;
          market: string;
          notes?: string | null;
          output_tokens?: number;
          provider_endpoints?: Json;
          provider_request_budget?: number;
          provider_requests?: number;
          raw_signals?: number;
          run_type?: string;
          shortlisted?: number;
          started_at?: string;
          status?: string;
          updated_at?: string;
          web_search_budget?: number;
          web_search_calls?: number;
          web_search_queries?: Json;
        };
        Update: {
          user_id?: string;
          ai_calls?: number;
          candidates_created?: number;
          clustered_duplicates?: number;
          completed_at?: string | null;
          coverage?: string;
          created_at?: string;
          created_by?: string | null;
          errors?: Json;
          estimated_cost_usd?: number;
          evaluated?: number;
          id?: string;
          input_tokens?: number;
          market?: string;
          notes?: string | null;
          output_tokens?: number;
          provider_endpoints?: Json;
          provider_request_budget?: number;
          provider_requests?: number;
          raw_signals?: number;
          run_type?: string;
          shortlisted?: number;
          started_at?: string;
          status?: string;
          updated_at?: string;
          web_search_budget?: number;
          web_search_calls?: number;
          web_search_queries?: Json;
        };
        Relationships: [];
      };
      discovery_settings: {
        Row: {
          user_id: string;
          auto_promote_enabled: boolean;
          auto_promote_top_n: number;
          created_at: string;
          created_by: string | null;
          id: string;
          max_eval_candidates: number;
          max_india_requests: number;
          max_us_web_queries: number;
          min_score: number;
          min_score_coverage_pct: number;
          min_source_tier: string;
          singleton: boolean;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          auto_promote_enabled?: boolean;
          auto_promote_top_n?: number;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          max_eval_candidates?: number;
          max_india_requests?: number;
          max_us_web_queries?: number;
          min_score?: number;
          min_score_coverage_pct?: number;
          min_source_tier?: string;
          singleton?: boolean;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          auto_promote_enabled?: boolean;
          auto_promote_top_n?: number;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          max_eval_candidates?: number;
          max_india_requests?: number;
          max_us_web_queries?: number;
          min_score?: number;
          min_score_coverage_pct?: number;
          min_source_tier?: string;
          singleton?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      earnings_reports: {
        Row: {
          user_id: string;
          after_hours_price: number | null;
          capex: number | null;
          closing_price: number | null;
          company_id: string;
          created_at: string;
          created_by: string | null;
          currency: string;
          earnings_date: string | null;
          eps_adjusted_actual: number | null;
          eps_consensus: number | null;
          eps_gaap_actual: number | null;
          eps_surprise_pct: number | null;
          fiscal_quarter: string | null;
          free_cash_flow: number | null;
          gross_margin: number | null;
          guidance_change: string | null;
          guidance_new: string | null;
          guidance_previous: string | null;
          id: string;
          is_demo: boolean;
          management_commentary: string | null;
          move_causes: string[];
          move_explanation: string | null;
          net_margin: number | null;
          next_day_reaction_pct: number | null;
          opening_price: number | null;
          operating_margin: number | null;
          previous_close: number | null;
          revenue_actual: number | null;
          revenue_consensus: number | null;
          revenue_surprise_pct: number | null;
          stock_based_comp: number | null;
          story_id: string | null;
          units: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          after_hours_price?: number | null;
          capex?: number | null;
          closing_price?: number | null;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          earnings_date?: string | null;
          eps_adjusted_actual?: number | null;
          eps_consensus?: number | null;
          eps_gaap_actual?: number | null;
          eps_surprise_pct?: number | null;
          fiscal_quarter?: string | null;
          free_cash_flow?: number | null;
          gross_margin?: number | null;
          guidance_change?: string | null;
          guidance_new?: string | null;
          guidance_previous?: string | null;
          id?: string;
          is_demo?: boolean;
          management_commentary?: string | null;
          move_causes?: string[];
          move_explanation?: string | null;
          net_margin?: number | null;
          next_day_reaction_pct?: number | null;
          opening_price?: number | null;
          operating_margin?: number | null;
          previous_close?: number | null;
          revenue_actual?: number | null;
          revenue_consensus?: number | null;
          revenue_surprise_pct?: number | null;
          stock_based_comp?: number | null;
          story_id?: string | null;
          units?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          after_hours_price?: number | null;
          capex?: number | null;
          closing_price?: number | null;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          earnings_date?: string | null;
          eps_adjusted_actual?: number | null;
          eps_consensus?: number | null;
          eps_gaap_actual?: number | null;
          eps_surprise_pct?: number | null;
          fiscal_quarter?: string | null;
          free_cash_flow?: number | null;
          gross_margin?: number | null;
          guidance_change?: string | null;
          guidance_new?: string | null;
          guidance_previous?: string | null;
          id?: string;
          is_demo?: boolean;
          management_commentary?: string | null;
          move_causes?: string[];
          move_explanation?: string | null;
          net_margin?: number | null;
          next_day_reaction_pct?: number | null;
          opening_price?: number | null;
          operating_margin?: number | null;
          previous_close?: number | null;
          revenue_actual?: number | null;
          revenue_consensus?: number | null;
          revenue_surprise_pct?: number | null;
          stock_based_comp?: number | null;
          story_id?: string | null;
          units?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "earnings_reports_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "earnings_reports_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      events: {
        Row: {
          user_id: string;
          company_id: string;
          created_at: string;
          created_by: string | null;
          description: string | null;
          event_type: string;
          id: string;
          importance: string;
          market_reaction: string | null;
          occurred_at: string;
          source_id: string | null;
          story_id: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          event_type?: string;
          id?: string;
          importance?: string;
          market_reaction?: string | null;
          occurred_at?: string;
          source_id?: string | null;
          story_id?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          event_type?: string;
          id?: string;
          importance?: string;
          market_reaction?: string | null;
          occurred_at?: string;
          source_id?: string | null;
          story_id?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "events_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "events_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "sources";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "events_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      fact_sprint_runs: {
        Row: {
          user_id: string;
          company_id: string | null;
          completed_at: string | null;
          conflicts: number;
          created_at: string;
          created_by: string | null;
          current_step: string | null;
          error: string | null;
          estimated_cost_usd: number;
          gaps: Json;
          gaps_filled: number;
          gaps_targeted: number;
          gaps_unresolved: number;
          id: string;
          inaccessible_primaries: number;
          latest_source_at: string | null;
          model: string | null;
          packet_id: string | null;
          packet_version: number | null;
          passes: number;
          searches: number;
          sources_added: number;
          status: string;
          story_id: string | null;
          summary: Json;
        };
        Insert: {
          user_id?: string;
          company_id?: string | null;
          completed_at?: string | null;
          conflicts?: number;
          created_at?: string;
          created_by?: string | null;
          current_step?: string | null;
          error?: string | null;
          estimated_cost_usd?: number;
          gaps?: Json;
          gaps_filled?: number;
          gaps_targeted?: number;
          gaps_unresolved?: number;
          id?: string;
          inaccessible_primaries?: number;
          latest_source_at?: string | null;
          model?: string | null;
          packet_id?: string | null;
          packet_version?: number | null;
          passes?: number;
          searches?: number;
          sources_added?: number;
          status?: string;
          story_id?: string | null;
          summary?: Json;
        };
        Update: {
          user_id?: string;
          company_id?: string | null;
          completed_at?: string | null;
          conflicts?: number;
          created_at?: string;
          created_by?: string | null;
          current_step?: string | null;
          error?: string | null;
          estimated_cost_usd?: number;
          gaps?: Json;
          gaps_filled?: number;
          gaps_targeted?: number;
          gaps_unresolved?: number;
          id?: string;
          inaccessible_primaries?: number;
          latest_source_at?: string | null;
          model?: string | null;
          packet_id?: string | null;
          packet_version?: number | null;
          passes?: number;
          searches?: number;
          sources_added?: number;
          status?: string;
          story_id?: string | null;
          summary?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "fact_sprint_runs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fact_sprint_runs_packet_id_fkey";
            columns: ["packet_id"];
            isOneToOne: false;
            referencedRelation: "research_packets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fact_sprint_runs_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      financial_periods: {
        Row: {
          user_id: string;
          accounts_receivable: number | null;
          basis: string;
          capex: number | null;
          cash: number | null;
          company_id: string;
          consolidation: string;
          created_at: string;
          created_by: string | null;
          currency: string;
          debt: number | null;
          ebitda: number | null;
          eps_adjusted: number | null;
          eps_gaap: number | null;
          fiscal_quarter: string | null;
          fiscal_year: number;
          free_cash_flow: number | null;
          gross_profit: number | null;
          id: string;
          inventory: number | null;
          is_demo: boolean;
          net_income: number | null;
          operating_cash_flow: number | null;
          operating_income: number | null;
          period_end: string | null;
          period_type: string;
          revenue: number | null;
          shareholder_equity: number | null;
          shares_outstanding: number | null;
          stock_based_comp: number | null;
          total_assets: number | null;
          total_liabilities: number | null;
          units: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          accounts_receivable?: number | null;
          basis?: string;
          capex?: number | null;
          cash?: number | null;
          company_id: string;
          consolidation?: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          debt?: number | null;
          ebitda?: number | null;
          eps_adjusted?: number | null;
          eps_gaap?: number | null;
          fiscal_quarter?: string | null;
          fiscal_year: number;
          free_cash_flow?: number | null;
          gross_profit?: number | null;
          id?: string;
          inventory?: number | null;
          is_demo?: boolean;
          net_income?: number | null;
          operating_cash_flow?: number | null;
          operating_income?: number | null;
          period_end?: string | null;
          period_type?: string;
          revenue?: number | null;
          shareholder_equity?: number | null;
          shares_outstanding?: number | null;
          stock_based_comp?: number | null;
          total_assets?: number | null;
          total_liabilities?: number | null;
          units?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          accounts_receivable?: number | null;
          basis?: string;
          capex?: number | null;
          cash?: number | null;
          company_id?: string;
          consolidation?: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          debt?: number | null;
          ebitda?: number | null;
          eps_adjusted?: number | null;
          eps_gaap?: number | null;
          fiscal_quarter?: string | null;
          fiscal_year?: number;
          free_cash_flow?: number | null;
          gross_profit?: number | null;
          id?: string;
          inventory?: number | null;
          is_demo?: boolean;
          net_income?: number | null;
          operating_cash_flow?: number | null;
          operating_income?: number | null;
          period_end?: string | null;
          period_type?: string;
          revenue?: number | null;
          shareholder_equity?: number | null;
          shares_outstanding?: number | null;
          stock_based_comp?: number | null;
          total_assets?: number | null;
          total_liabilities?: number | null;
          units?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "financial_periods_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      market_holidays: {
        Row: {
          user_id: string;
          created_at: string;
          created_by: string | null;
          holiday_date: string;
          holiday_name: string;
          id: string;
          market: string;
          market_closed: boolean;
          source: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          created_at?: string;
          created_by?: string | null;
          holiday_date: string;
          holiday_name: string;
          id?: string;
          market: string;
          market_closed?: boolean;
          source?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          created_at?: string;
          created_by?: string | null;
          holiday_date?: string;
          holiday_name?: string;
          id?: string;
          market?: string;
          market_closed?: boolean;
          source?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      market_schedules: {
        Row: {
          user_id: string;
          created_at: string;
          created_by: string | null;
          delta_max_eval_candidates: number;
          delta_max_provider_requests: number;
          delta_max_web_searches: number;
          delta_run_local: string;
          enabled: boolean;
          honor_holidays: boolean;
          id: string;
          main_max_eval_candidates: number;
          main_max_provider_requests: number;
          main_max_web_searches: number;
          main_run_local: string;
          market: string;
          market_close_local: string;
          skip_weekends: boolean;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          created_at?: string;
          created_by?: string | null;
          delta_max_eval_candidates?: number;
          delta_max_provider_requests?: number;
          delta_max_web_searches?: number;
          delta_run_local: string;
          enabled?: boolean;
          honor_holidays?: boolean;
          id?: string;
          main_max_eval_candidates?: number;
          main_max_provider_requests?: number;
          main_max_web_searches?: number;
          main_run_local: string;
          market: string;
          market_close_local: string;
          skip_weekends?: boolean;
          timezone: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          created_at?: string;
          created_by?: string | null;
          delta_max_eval_candidates?: number;
          delta_max_provider_requests?: number;
          delta_max_web_searches?: number;
          delta_run_local?: string;
          enabled?: boolean;
          honor_holidays?: boolean;
          id?: string;
          main_max_eval_candidates?: number;
          main_max_provider_requests?: number;
          main_max_web_searches?: number;
          main_run_local?: string;
          market?: string;
          market_close_local?: string;
          skip_weekends?: boolean;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      market_snapshots: {
        Row: {
          user_id: string;
          as_of: string;
          avg_volume_20d: number | null;
          company_id: string;
          created_at: string;
          created_by: string | null;
          daily_change_pct: number | null;
          data_mode: string;
          freshness: string;
          id: string;
          ingestion_run_id: string | null;
          is_demo: boolean;
          previous_close: number | null;
          price: number | null;
          provider: string | null;
          source: string | null;
          updated_at: string;
          volume: number | null;
          volume_ratio: number | null;
        };
        Insert: {
          user_id?: string;
          as_of?: string;
          avg_volume_20d?: number | null;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          daily_change_pct?: number | null;
          data_mode?: string;
          freshness?: string;
          id?: string;
          ingestion_run_id?: string | null;
          is_demo?: boolean;
          previous_close?: number | null;
          price?: number | null;
          provider?: string | null;
          source?: string | null;
          updated_at?: string;
          volume?: number | null;
          volume_ratio?: number | null;
        };
        Update: {
          user_id?: string;
          as_of?: string;
          avg_volume_20d?: number | null;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          daily_change_pct?: number | null;
          data_mode?: string;
          freshness?: string;
          id?: string;
          ingestion_run_id?: string | null;
          is_demo?: boolean;
          previous_close?: number | null;
          price?: number | null;
          provider?: string | null;
          source?: string | null;
          updated_at?: string;
          volume?: number | null;
          volume_ratio?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "market_snapshots_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          user_id: string;
          avatar_url: string | null;
          channel_name: string | null;
          created_at: string;
          default_platform: string;
          display_name: string | null;
          email: string | null;
          host_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          avatar_url?: string | null;
          channel_name?: string | null;
          created_at?: string;
          default_platform?: string;
          display_name?: string | null;
          email?: string | null;
          host_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          avatar_url?: string | null;
          channel_name?: string | null;
          created_at?: string;
          default_platform?: string;
          display_name?: string | null;
          email?: string | null;
          host_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      provider_data_conflicts: {
        Row: {
          user_id: string;
          company_id: string | null;
          created_at: string;
          created_by: string | null;
          entity: string;
          entity_id: string | null;
          existing_value: string | null;
          field: string;
          id: string;
          incoming_value: string | null;
          ingestion_run_id: string | null;
          provider: string;
          resolution: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          company_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          entity: string;
          entity_id?: string | null;
          existing_value?: string | null;
          field: string;
          id?: string;
          incoming_value?: string | null;
          ingestion_run_id?: string | null;
          provider?: string;
          resolution?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          company_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          entity?: string;
          entity_id?: string | null;
          existing_value?: string | null;
          field?: string;
          id?: string;
          incoming_value?: string | null;
          ingestion_run_id?: string | null;
          provider?: string;
          resolution?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "provider_data_conflicts_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_raw_responses: {
        Row: {
          user_id: string;
          created_at: string;
          created_by: string | null;
          endpoint: string;
          id: string;
          ingestion_run_id: string | null;
          label: string;
          payload: Json;
          provider: string;
          query: string | null;
          request_id: string | null;
        };
        Insert: {
          user_id?: string;
          created_at?: string;
          created_by?: string | null;
          endpoint: string;
          id?: string;
          ingestion_run_id?: string | null;
          label?: string;
          payload: Json;
          provider?: string;
          query?: string | null;
          request_id?: string | null;
        };
        Update: {
          user_id?: string;
          created_at?: string;
          created_by?: string | null;
          endpoint?: string;
          id?: string;
          ingestion_run_id?: string | null;
          label?: string;
          payload?: Json;
          provider?: string;
          query?: string | null;
          request_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "provider_raw_responses_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "provider_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_requests: {
        Row: {
          user_id: string;
          created_at: string;
          created_by: string | null;
          endpoint: string;
          error: string | null;
          id: string;
          ingestion_run_id: string | null;
          is_test: boolean;
          latency_ms: number | null;
          ok: boolean;
          params: Json;
          provider: string;
          status_code: number | null;
        };
        Insert: {
          user_id?: string;
          created_at?: string;
          created_by?: string | null;
          endpoint: string;
          error?: string | null;
          id?: string;
          ingestion_run_id?: string | null;
          is_test?: boolean;
          latency_ms?: number | null;
          ok?: boolean;
          params?: Json;
          provider?: string;
          status_code?: number | null;
        };
        Update: {
          user_id?: string;
          created_at?: string;
          created_by?: string | null;
          endpoint?: string;
          error?: string | null;
          id?: string;
          ingestion_run_id?: string | null;
          is_test?: boolean;
          latency_ms?: number | null;
          ok?: boolean;
          params?: Json;
          provider?: string;
          status_code?: number | null;
        };
        Relationships: [];
      };
      provider_stock_data: {
        Row: {
          user_id: string;
          company_id: string | null;
          company_searched: string;
          created_at: string;
          created_by: string | null;
          currency: string;
          data_mode: string;
          endpoint: string;
          id: string;
          ingestion_run_id: string | null;
          mapped: Json;
          provider: string;
          provider_timestamp: string | null;
          raw_response_id: string | null;
          retrieved_at: string;
          source_identifier: string | null;
          unmapped: Json;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          company_id?: string | null;
          company_searched: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          data_mode?: string;
          endpoint: string;
          id?: string;
          ingestion_run_id?: string | null;
          mapped?: Json;
          provider?: string;
          provider_timestamp?: string | null;
          raw_response_id?: string | null;
          retrieved_at?: string;
          source_identifier?: string | null;
          unmapped?: Json;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          company_id?: string | null;
          company_searched?: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          data_mode?: string;
          endpoint?: string;
          id?: string;
          ingestion_run_id?: string | null;
          mapped?: Json;
          provider?: string;
          provider_timestamp?: string | null;
          raw_response_id?: string | null;
          retrieved_at?: string;
          source_identifier?: string | null;
          unmapped?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "provider_stock_data_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "provider_stock_data_raw_response_id_fkey";
            columns: ["raw_response_id"];
            isOneToOne: false;
            referencedRelation: "provider_raw_responses";
            referencedColumns: ["id"];
          },
        ];
      };
      quantitative_metrics: {
        Row: {
          user_id: string;
          as_of: string;
          beta: number | null;
          company_id: string;
          created_at: string;
          created_by: string | null;
          earnings_surprise: number | null;
          historical_earnings_reaction: string | null;
          id: string;
          is_demo: boolean;
          max_drawdown: number | null;
          relative_return_index: number | null;
          relative_return_sector: number | null;
          return_1d: number | null;
          return_1m: number | null;
          return_1y: number | null;
          return_3m: number | null;
          return_5d: number | null;
          return_ytd: number | null;
          updated_at: string;
          valuation_percentile: number | null;
          volatility: number | null;
          volume_ratio: number | null;
        };
        Insert: {
          user_id?: string;
          as_of?: string;
          beta?: number | null;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          earnings_surprise?: number | null;
          historical_earnings_reaction?: string | null;
          id?: string;
          is_demo?: boolean;
          max_drawdown?: number | null;
          relative_return_index?: number | null;
          relative_return_sector?: number | null;
          return_1d?: number | null;
          return_1m?: number | null;
          return_1y?: number | null;
          return_3m?: number | null;
          return_5d?: number | null;
          return_ytd?: number | null;
          updated_at?: string;
          valuation_percentile?: number | null;
          volatility?: number | null;
          volume_ratio?: number | null;
        };
        Update: {
          user_id?: string;
          as_of?: string;
          beta?: number | null;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          earnings_surprise?: number | null;
          historical_earnings_reaction?: string | null;
          id?: string;
          is_demo?: boolean;
          max_drawdown?: number | null;
          relative_return_index?: number | null;
          relative_return_sector?: number | null;
          return_1d?: number | null;
          return_1m?: number | null;
          return_1y?: number | null;
          return_3m?: number | null;
          return_5d?: number | null;
          return_ytd?: number | null;
          updated_at?: string;
          valuation_percentile?: number | null;
          volatility?: number | null;
          volume_ratio?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "quantitative_metrics_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      research_gaps: {
        Row: {
          user_id: string;
          ai_calls: number;
          audit_id: string | null;
          claim_under_investigation: string;
          classification: string | null;
          company_id: string | null;
          created_at: string;
          created_by: string | null;
          duplicate_statements: Json;
          estimated_cost_usd: number;
          event_date: string | null;
          gap_key: string | null;
          id: string;
          input_tokens: number;
          market: string | null;
          missing_evidence_type: string;
          original_statement: string;
          output_tokens: number;
          priority: string;
          queries: Json;
          reason: string;
          research_packet_id: string | null;
          resolution_notes: string | null;
          resolution_type: string;
          resolved_at: string | null;
          resolved_claim_ids: string[];
          resolved_packet_id: string | null;
          resolved_packet_version: number | null;
          resolved_source_ids: string[];
          script_id: string | null;
          script_version: number | null;
          script_version_id: string | null;
          searches_performed: number;
          sources_accepted: number;
          sources_found: number;
          sources_rejected: number;
          statement_id: string | null;
          status: string;
          story_id: string | null;
          ticker: string | null;
          updated_at: string;
          web_search_calls: number;
        };
        Insert: {
          user_id?: string;
          ai_calls?: number;
          audit_id?: string | null;
          claim_under_investigation: string;
          classification?: string | null;
          company_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          duplicate_statements?: Json;
          estimated_cost_usd?: number;
          event_date?: string | null;
          gap_key?: string | null;
          id?: string;
          input_tokens?: number;
          market?: string | null;
          missing_evidence_type?: string;
          original_statement: string;
          output_tokens?: number;
          priority?: string;
          queries?: Json;
          reason?: string;
          research_packet_id?: string | null;
          resolution_notes?: string | null;
          resolution_type?: string;
          resolved_at?: string | null;
          resolved_claim_ids?: string[];
          resolved_packet_id?: string | null;
          resolved_packet_version?: number | null;
          resolved_source_ids?: string[];
          script_id?: string | null;
          script_version?: number | null;
          script_version_id?: string | null;
          searches_performed?: number;
          sources_accepted?: number;
          sources_found?: number;
          sources_rejected?: number;
          statement_id?: string | null;
          status?: string;
          story_id?: string | null;
          ticker?: string | null;
          updated_at?: string;
          web_search_calls?: number;
        };
        Update: {
          user_id?: string;
          ai_calls?: number;
          audit_id?: string | null;
          claim_under_investigation?: string;
          classification?: string | null;
          company_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          duplicate_statements?: Json;
          estimated_cost_usd?: number;
          event_date?: string | null;
          gap_key?: string | null;
          id?: string;
          input_tokens?: number;
          market?: string | null;
          missing_evidence_type?: string;
          original_statement?: string;
          output_tokens?: number;
          priority?: string;
          queries?: Json;
          reason?: string;
          research_packet_id?: string | null;
          resolution_notes?: string | null;
          resolution_type?: string;
          resolved_at?: string | null;
          resolved_claim_ids?: string[];
          resolved_packet_id?: string | null;
          resolved_packet_version?: number | null;
          resolved_source_ids?: string[];
          script_id?: string | null;
          script_version?: number | null;
          script_version_id?: string | null;
          searches_performed?: number;
          sources_accepted?: number;
          sources_found?: number;
          sources_rejected?: number;
          statement_id?: string | null;
          status?: string;
          story_id?: string | null;
          ticker?: string | null;
          updated_at?: string;
          web_search_calls?: number;
        };
        Relationships: [
          {
            foreignKeyName: "research_gaps_audit_id_fkey";
            columns: ["audit_id"];
            isOneToOne: false;
            referencedRelation: "script_audits";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "research_gaps_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "research_gaps_research_packet_id_fkey";
            columns: ["research_packet_id"];
            isOneToOne: false;
            referencedRelation: "research_packets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "research_gaps_resolved_packet_id_fkey";
            columns: ["resolved_packet_id"];
            isOneToOne: false;
            referencedRelation: "research_packets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "research_gaps_script_id_fkey";
            columns: ["script_id"];
            isOneToOne: false;
            referencedRelation: "scripts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "research_gaps_script_version_id_fkey";
            columns: ["script_version_id"];
            isOneToOne: false;
            referencedRelation: "script_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "research_gaps_statement_id_fkey";
            columns: ["statement_id"];
            isOneToOne: false;
            referencedRelation: "script_statements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "research_gaps_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      research_orchestration_runs: {
        Row: {
          user_id: string;
          ai_calls: number;
          claims_added: number;
          company_id: string | null;
          completed_at: string | null;
          conflicts_found: number;
          coverage_flag: string | null;
          created_at: string;
          created_by: string | null;
          current_step: string | null;
          data_plan: Json;
          delta: Json;
          errors: Json;
          estimated_cost_usd: number;
          freshness: Json;
          id: string;
          indianapi_requests: number;
          input_tokens: number;
          is_rerun: boolean;
          market: string | null;
          output_tokens: number;
          packet_builds: number;
          packet_final_id: string | null;
          packet_final_version: number | null;
          packet_start_id: string | null;
          packet_start_version: number | null;
          provider_requests: number;
          readiness: string | null;
          readiness_reason: string | null;
          readiness_summary: Json;
          sec_requests: number;
          sources_added: number;
          started_at: string;
          status: string;
          story_id: string;
          trigger_source: string;
          updated_at: string;
          warnings: Json;
          web_searches: number;
        };
        Insert: {
          user_id?: string;
          ai_calls?: number;
          claims_added?: number;
          company_id?: string | null;
          completed_at?: string | null;
          conflicts_found?: number;
          coverage_flag?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_step?: string | null;
          data_plan?: Json;
          delta?: Json;
          errors?: Json;
          estimated_cost_usd?: number;
          freshness?: Json;
          id?: string;
          indianapi_requests?: number;
          input_tokens?: number;
          is_rerun?: boolean;
          market?: string | null;
          output_tokens?: number;
          packet_builds?: number;
          packet_final_id?: string | null;
          packet_final_version?: number | null;
          packet_start_id?: string | null;
          packet_start_version?: number | null;
          provider_requests?: number;
          readiness?: string | null;
          readiness_reason?: string | null;
          readiness_summary?: Json;
          sec_requests?: number;
          sources_added?: number;
          started_at?: string;
          status?: string;
          story_id: string;
          trigger_source?: string;
          updated_at?: string;
          warnings?: Json;
          web_searches?: number;
        };
        Update: {
          user_id?: string;
          ai_calls?: number;
          claims_added?: number;
          company_id?: string | null;
          completed_at?: string | null;
          conflicts_found?: number;
          coverage_flag?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_step?: string | null;
          data_plan?: Json;
          delta?: Json;
          errors?: Json;
          estimated_cost_usd?: number;
          freshness?: Json;
          id?: string;
          indianapi_requests?: number;
          input_tokens?: number;
          is_rerun?: boolean;
          market?: string | null;
          output_tokens?: number;
          packet_builds?: number;
          packet_final_id?: string | null;
          packet_final_version?: number | null;
          packet_start_id?: string | null;
          packet_start_version?: number | null;
          provider_requests?: number;
          readiness?: string | null;
          readiness_reason?: string | null;
          readiness_summary?: Json;
          sec_requests?: number;
          sources_added?: number;
          started_at?: string;
          status?: string;
          story_id?: string;
          trigger_source?: string;
          updated_at?: string;
          warnings?: Json;
          web_searches?: number;
        };
        Relationships: [
          {
            foreignKeyName: "research_orchestration_runs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "research_orchestration_runs_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      research_orchestration_settings: {
        Row: {
          user_id: string;
          batch_max_stories: number;
          created_at: string;
          financials_max_age_days: number;
          id: string;
          india_max_company_calls: number;
          indianapi_quota_reserve: number;
          market_data_max_age_hours: number;
          max_packet_builds: number;
          max_scenario_runs: number;
          sec_max_age_days: number;
          updated_at: string;
          web_max_queries: number;
        };
        Insert: {
          user_id?: string;
          batch_max_stories?: number;
          created_at?: string;
          financials_max_age_days?: number;
          id?: string;
          india_max_company_calls?: number;
          indianapi_quota_reserve?: number;
          market_data_max_age_hours?: number;
          max_packet_builds?: number;
          max_scenario_runs?: number;
          sec_max_age_days?: number;
          updated_at?: string;
          web_max_queries?: number;
        };
        Update: {
          user_id?: string;
          batch_max_stories?: number;
          created_at?: string;
          financials_max_age_days?: number;
          id?: string;
          india_max_company_calls?: number;
          indianapi_quota_reserve?: number;
          market_data_max_age_hours?: number;
          max_packet_builds?: number;
          max_scenario_runs?: number;
          sec_max_age_days?: number;
          updated_at?: string;
          web_max_queries?: number;
        };
        Relationships: [];
      };
      research_orchestration_steps: {
        Row: {
          user_id: string;
          completed_at: string | null;
          created_at: string;
          detail: string | null;
          error: string | null;
          id: string;
          label: string;
          metrics: Json;
          run_id: string;
          started_at: string | null;
          status: string;
          step_index: number;
          step_key: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          completed_at?: string | null;
          created_at?: string;
          detail?: string | null;
          error?: string | null;
          id?: string;
          label: string;
          metrics?: Json;
          run_id: string;
          started_at?: string | null;
          status?: string;
          step_index?: number;
          step_key: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          completed_at?: string | null;
          created_at?: string;
          detail?: string | null;
          error?: string | null;
          id?: string;
          label?: string;
          metrics?: Json;
          run_id?: string;
          started_at?: string | null;
          status?: string;
          step_index?: number;
          step_key?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "research_orchestration_steps_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "research_orchestration_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      research_packets: {
        Row: {
          user_id: string;
          company_id: string;
          completed_at: string | null;
          completion_pct: number;
          created_at: string;
          created_by: string | null;
          evidence_snapshot: Json | null;
          id: string;
          parent_packet_id: string | null;
          status: string;
          story_id: string;
          update_reason: string | null;
          updated_at: string;
          verification_score: number;
          version_number: number;
        };
        Insert: {
          user_id?: string;
          company_id: string;
          completed_at?: string | null;
          completion_pct?: number;
          created_at?: string;
          created_by?: string | null;
          evidence_snapshot?: Json | null;
          id?: string;
          parent_packet_id?: string | null;
          status?: string;
          story_id: string;
          update_reason?: string | null;
          updated_at?: string;
          verification_score?: number;
          version_number?: number;
        };
        Update: {
          user_id?: string;
          company_id?: string;
          completed_at?: string | null;
          completion_pct?: number;
          created_at?: string;
          created_by?: string | null;
          evidence_snapshot?: Json | null;
          id?: string;
          parent_packet_id?: string | null;
          status?: string;
          story_id?: string;
          update_reason?: string | null;
          updated_at?: string;
          verification_score?: number;
          version_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "research_packets_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "research_packets_parent_packet_id_fkey";
            columns: ["parent_packet_id"];
            isOneToOne: false;
            referencedRelation: "research_packets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "research_packets_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      research_sections: {
        Row: {
          user_id: string;
          content: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          packet_id: string;
          section_key: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          content?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          packet_id: string;
          section_key: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          content?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          packet_id?: string;
          section_key?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "research_sections_packet_id_fkey";
            columns: ["packet_id"];
            isOneToOne: false;
            referencedRelation: "research_packets";
            referencedColumns: ["id"];
          },
        ];
      };
      run_locks: {
        Row: {
          user_id: string;
          acquired_at: string;
          created_at: string;
          execution_id: string | null;
          expires_at: string;
          heartbeat_at: string;
          id: string;
          lock_key: string;
          owner: string;
        };
        Insert: {
          user_id?: string;
          acquired_at?: string;
          created_at?: string;
          execution_id?: string | null;
          expires_at: string;
          heartbeat_at?: string;
          id?: string;
          lock_key: string;
          owner: string;
        };
        Update: {
          user_id?: string;
          acquired_at?: string;
          created_at?: string;
          execution_id?: string | null;
          expires_at?: string;
          heartbeat_at?: string;
          id?: string;
          lock_key?: string;
          owner?: string;
        };
        Relationships: [];
      };
      run_notifications: {
        Row: {
          user_id: string;
          body: string | null;
          candidate_id: string | null;
          created_at: string;
          daily_run_id: string | null;
          execution_id: string | null;
          id: string;
          kind: string;
          market: string | null;
          read_at: string | null;
          severity: string;
          title: string;
        };
        Insert: {
          user_id?: string;
          body?: string | null;
          candidate_id?: string | null;
          created_at?: string;
          daily_run_id?: string | null;
          execution_id?: string | null;
          id?: string;
          kind: string;
          market?: string | null;
          read_at?: string | null;
          severity?: string;
          title: string;
        };
        Update: {
          user_id?: string;
          body?: string | null;
          candidate_id?: string | null;
          created_at?: string;
          daily_run_id?: string | null;
          execution_id?: string | null;
          id?: string;
          kind?: string;
          market?: string | null;
          read_at?: string | null;
          severity?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "run_notifications_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "story_candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "run_notifications_daily_run_id_fkey";
            columns: ["daily_run_id"];
            isOneToOne: false;
            referencedRelation: "daily_market_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "run_notifications_execution_id_fkey";
            columns: ["execution_id"];
            isOneToOne: false;
            referencedRelation: "daily_run_executions";
            referencedColumns: ["id"];
          },
        ];
      };
      scenario_forecasts: {
        Row: {
          user_id: string;
          assumptions: string | null;
          catalysts: string | null;
          confidence: string;
          created_at: string;
          created_by: string | null;
          financial_assumptions: string | null;
          id: string;
          invalidation_conditions: string | null;
          packet_id: string;
          probability: number;
          risks: string | null;
          scenario_type: string;
          time_horizon: string;
          updated_at: string;
          valuation_high: number | null;
          valuation_low: number | null;
        };
        Insert: {
          user_id?: string;
          assumptions?: string | null;
          catalysts?: string | null;
          confidence?: string;
          created_at?: string;
          created_by?: string | null;
          financial_assumptions?: string | null;
          id?: string;
          invalidation_conditions?: string | null;
          packet_id: string;
          probability?: number;
          risks?: string | null;
          scenario_type: string;
          time_horizon?: string;
          updated_at?: string;
          valuation_high?: number | null;
          valuation_low?: number | null;
        };
        Update: {
          user_id?: string;
          assumptions?: string | null;
          catalysts?: string | null;
          confidence?: string;
          created_at?: string;
          created_by?: string | null;
          financial_assumptions?: string | null;
          id?: string;
          invalidation_conditions?: string | null;
          packet_id?: string;
          probability?: number;
          risks?: string | null;
          scenario_type?: string;
          time_horizon?: string;
          updated_at?: string;
          valuation_high?: number | null;
          valuation_low?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "scenario_forecasts_packet_id_fkey";
            columns: ["packet_id"];
            isOneToOne: false;
            referencedRelation: "research_packets";
            referencedColumns: ["id"];
          },
        ];
      };
      scores: {
        Row: {
          user_id: string;
          classification: string | null;
          company_id: string | null;
          components: Json;
          created_at: string;
          created_by: string | null;
          id: string;
          reasoning: string | null;
          score_type: string;
          story_id: string | null;
          total: number;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          classification?: string | null;
          company_id?: string | null;
          components?: Json;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          reasoning?: string | null;
          score_type: string;
          story_id?: string | null;
          total?: number;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          classification?: string | null;
          company_id?: string | null;
          components?: Json;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          reasoning?: string | null;
          score_type?: string;
          story_id?: string | null;
          total?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scores_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scores_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      script_audits: {
        Row: {
          user_id: string;
          audit_pass: string;
          blocking_reasons: Json;
          body_hash: string | null;
          conflicting: number;
          created_at: string;
          created_by: string | null;
          estimated_cost_usd: number;
          id: string;
          model: string | null;
          needs_qualification: number;
          numeric_failures: number;
          numeric_precheck: Json;
          numeric_precheck_blocking: number;
          packet_id: string | null;
          packet_version: number | null;
          readiness_gate: Json;
          ready_for_review: boolean;
          repair_id: string | null;
          script_id: string;
          statements_total: number;
          status: string;
          summary: string | null;
          supported: number;
          supported_with_attribution: number;
          unsupported: number;
          warnings: Json;
          within_word_budget: boolean | null;
          word_count: number | null;
        };
        Insert: {
          user_id?: string;
          audit_pass?: string;
          blocking_reasons?: Json;
          body_hash?: string | null;
          conflicting?: number;
          created_at?: string;
          created_by?: string | null;
          estimated_cost_usd?: number;
          id?: string;
          model?: string | null;
          needs_qualification?: number;
          numeric_failures?: number;
          numeric_precheck?: Json;
          numeric_precheck_blocking?: number;
          packet_id?: string | null;
          packet_version?: number | null;
          readiness_gate?: Json;
          ready_for_review?: boolean;
          repair_id?: string | null;
          script_id: string;
          statements_total?: number;
          status?: string;
          summary?: string | null;
          supported?: number;
          supported_with_attribution?: number;
          unsupported?: number;
          warnings?: Json;
          within_word_budget?: boolean | null;
          word_count?: number | null;
        };
        Update: {
          user_id?: string;
          audit_pass?: string;
          blocking_reasons?: Json;
          body_hash?: string | null;
          conflicting?: number;
          created_at?: string;
          created_by?: string | null;
          estimated_cost_usd?: number;
          id?: string;
          model?: string | null;
          needs_qualification?: number;
          numeric_failures?: number;
          numeric_precheck?: Json;
          numeric_precheck_blocking?: number;
          packet_id?: string | null;
          packet_version?: number | null;
          readiness_gate?: Json;
          ready_for_review?: boolean;
          repair_id?: string | null;
          script_id?: string;
          statements_total?: number;
          status?: string;
          summary?: string | null;
          supported?: number;
          supported_with_attribution?: number;
          unsupported?: number;
          warnings?: Json;
          within_word_budget?: boolean | null;
          word_count?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "script_audits_packet_id_fkey";
            columns: ["packet_id"];
            isOneToOne: false;
            referencedRelation: "research_packets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "script_audits_script_id_fkey";
            columns: ["script_id"];
            isOneToOne: false;
            referencedRelation: "scripts";
            referencedColumns: ["id"];
          },
        ];
      };
      script_repairs: {
        Row: {
          user_id: string;
          attributed: number;
          corrected: number;
          created_at: string;
          created_by: string | null;
          estimated_cost_usd: number;
          final_audit_id: string | null;
          id: string;
          initial_audit_id: string | null;
          items: Json;
          items_total: number;
          model: string | null;
          notes: string | null;
          packet_id: string | null;
          packet_version: number | null;
          qualified: number;
          removed: number;
          script_id: string;
          script_version: number | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          attributed?: number;
          corrected?: number;
          created_at?: string;
          created_by?: string | null;
          estimated_cost_usd?: number;
          final_audit_id?: string | null;
          id?: string;
          initial_audit_id?: string | null;
          items?: Json;
          items_total?: number;
          model?: string | null;
          notes?: string | null;
          packet_id?: string | null;
          packet_version?: number | null;
          qualified?: number;
          removed?: number;
          script_id: string;
          script_version?: number | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          attributed?: number;
          corrected?: number;
          created_at?: string;
          created_by?: string | null;
          estimated_cost_usd?: number;
          final_audit_id?: string | null;
          id?: string;
          initial_audit_id?: string | null;
          items?: Json;
          items_total?: number;
          model?: string | null;
          notes?: string | null;
          packet_id?: string | null;
          packet_version?: number | null;
          qualified?: number;
          removed?: number;
          script_id?: string;
          script_version?: number | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "script_repairs_final_audit_id_fkey";
            columns: ["final_audit_id"];
            isOneToOne: false;
            referencedRelation: "script_audits";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "script_repairs_initial_audit_id_fkey";
            columns: ["initial_audit_id"];
            isOneToOne: false;
            referencedRelation: "script_audits";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "script_repairs_packet_id_fkey";
            columns: ["packet_id"];
            isOneToOne: false;
            referencedRelation: "research_packets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "script_repairs_script_id_fkey";
            columns: ["script_id"];
            isOneToOne: false;
            referencedRelation: "scripts";
            referencedColumns: ["id"];
          },
        ];
      };
      script_sections: {
        Row: {
          user_id: string;
          claim_ids: string[];
          created_at: string;
          created_by: string | null;
          id: string;
          label: string;
          metric_keys: string[];
          micro_hook: string | null;
          on_screen_text: string | null;
          order_index: number;
          research_section_ids: string[];
          script_id: string;
          section_key: string;
          source_ids: string[];
          spoken_text: string;
          time_range: string | null;
          updated_at: string;
          visual_note: string | null;
        };
        Insert: {
          user_id?: string;
          claim_ids?: string[];
          created_at?: string;
          created_by?: string | null;
          id?: string;
          label: string;
          metric_keys?: string[];
          micro_hook?: string | null;
          on_screen_text?: string | null;
          order_index?: number;
          research_section_ids?: string[];
          script_id: string;
          section_key: string;
          source_ids?: string[];
          spoken_text?: string;
          time_range?: string | null;
          updated_at?: string;
          visual_note?: string | null;
        };
        Update: {
          user_id?: string;
          claim_ids?: string[];
          created_at?: string;
          created_by?: string | null;
          id?: string;
          label?: string;
          metric_keys?: string[];
          micro_hook?: string | null;
          on_screen_text?: string | null;
          order_index?: number;
          research_section_ids?: string[];
          script_id?: string;
          section_key?: string;
          source_ids?: string[];
          spoken_text?: string;
          time_range?: string | null;
          updated_at?: string;
          visual_note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "script_sections_script_id_fkey";
            columns: ["script_id"];
            isOneToOne: false;
            referencedRelation: "scripts";
            referencedColumns: ["id"];
          },
        ];
      };
      script_statements: {
        Row: {
          user_id: string;
          audit_id: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          is_numeric: boolean;
          issue: string | null;
          matched_claim_id: string | null;
          matched_metric_key: string | null;
          matched_source_id: string | null;
          origin: string;
          precheck_kind: string | null;
          recommended_wording: string | null;
          research_value: string | null;
          resolution_type: string | null;
          script_id: string;
          script_value: string | null;
          section_id: string | null;
          section_key: string | null;
          severity: string;
          statement_text: string;
          statement_type: string;
          status: string;
        };
        Insert: {
          user_id?: string;
          audit_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_numeric?: boolean;
          issue?: string | null;
          matched_claim_id?: string | null;
          matched_metric_key?: string | null;
          matched_source_id?: string | null;
          origin?: string;
          precheck_kind?: string | null;
          recommended_wording?: string | null;
          research_value?: string | null;
          resolution_type?: string | null;
          script_id: string;
          script_value?: string | null;
          section_id?: string | null;
          section_key?: string | null;
          severity?: string;
          statement_text: string;
          statement_type?: string;
          status?: string;
        };
        Update: {
          user_id?: string;
          audit_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_numeric?: boolean;
          issue?: string | null;
          matched_claim_id?: string | null;
          matched_metric_key?: string | null;
          matched_source_id?: string | null;
          origin?: string;
          precheck_kind?: string | null;
          recommended_wording?: string | null;
          research_value?: string | null;
          resolution_type?: string | null;
          script_id?: string;
          script_value?: string | null;
          section_id?: string | null;
          section_key?: string | null;
          severity?: string;
          statement_text?: string;
          statement_type?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "script_statements_audit_id_fkey";
            columns: ["audit_id"];
            isOneToOne: false;
            referencedRelation: "script_audits";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "script_statements_matched_claim_id_fkey";
            columns: ["matched_claim_id"];
            isOneToOne: false;
            referencedRelation: "claims";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "script_statements_matched_source_id_fkey";
            columns: ["matched_source_id"];
            isOneToOne: false;
            referencedRelation: "sources";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "script_statements_script_id_fkey";
            columns: ["script_id"];
            isOneToOne: false;
            referencedRelation: "scripts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "script_statements_section_id_fkey";
            columns: ["section_id"];
            isOneToOne: false;
            referencedRelation: "script_sections";
            referencedColumns: ["id"];
          },
        ];
      };
      script_style_checks: {
        Row: {
          user_id: string;
          created_at: string;
          created_by: string | null;
          findings: Json;
          id: string;
          metrics: Json;
          script_id: string;
          script_version: number | null;
          status: string;
          style_profile_id: string | null;
          style_profile_version: number | null;
          summary: string | null;
          updated_at: string;
          warnings_total: number;
        };
        Insert: {
          user_id?: string;
          created_at?: string;
          created_by?: string | null;
          findings?: Json;
          id?: string;
          metrics?: Json;
          script_id: string;
          script_version?: number | null;
          status?: string;
          style_profile_id?: string | null;
          style_profile_version?: number | null;
          summary?: string | null;
          updated_at?: string;
          warnings_total?: number;
        };
        Update: {
          user_id?: string;
          created_at?: string;
          created_by?: string | null;
          findings?: Json;
          id?: string;
          metrics?: Json;
          script_id?: string;
          script_version?: number | null;
          status?: string;
          style_profile_id?: string | null;
          style_profile_version?: number | null;
          summary?: string | null;
          updated_at?: string;
          warnings_total?: number;
        };
        Relationships: [
          {
            foreignKeyName: "script_style_checks_script_id_fkey";
            columns: ["script_id"];
            isOneToOne: false;
            referencedRelation: "scripts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "script_style_checks_style_profile_id_fkey";
            columns: ["style_profile_id"];
            isOneToOne: false;
            referencedRelation: "script_style_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      script_style_profiles: {
        Row: {
          content_category_defaults: Json;
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          is_active: boolean;
          is_default: boolean;
          language_style: string;
          name: string;
          platform_defaults: Json;
          prompt_text: string;
          slug: string;
          style_checklist: string | null;
          updated_at: string;
          version: number;
          word_count_defaults: Json;
        };
        Insert: {
          content_category_defaults?: Json;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          is_default?: boolean;
          language_style: string;
          name: string;
          platform_defaults?: Json;
          prompt_text: string;
          slug: string;
          style_checklist?: string | null;
          updated_at?: string;
          version?: number;
          word_count_defaults?: Json;
        };
        Update: {
          content_category_defaults?: Json;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          is_default?: boolean;
          language_style?: string;
          name?: string;
          platform_defaults?: Json;
          prompt_text?: string;
          slug?: string;
          style_checklist?: string | null;
          updated_at?: string;
          version?: number;
          word_count_defaults?: Json;
        };
        Relationships: [];
      };
      script_versions: {
        Row: {
          user_id: string;
          audit_status: string | null;
          body: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          model: string | null;
          note: string | null;
          packet_id: string | null;
          research_packet_version: number | null;
          script_id: string;
          style_profile_id: string | null;
          style_profile_version: number | null;
          template_version: string | null;
          version: number;
        };
        Insert: {
          user_id?: string;
          audit_status?: string | null;
          body?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          model?: string | null;
          note?: string | null;
          packet_id?: string | null;
          research_packet_version?: number | null;
          script_id: string;
          style_profile_id?: string | null;
          style_profile_version?: number | null;
          template_version?: string | null;
          version?: number;
        };
        Update: {
          user_id?: string;
          audit_status?: string | null;
          body?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          model?: string | null;
          note?: string | null;
          packet_id?: string | null;
          research_packet_version?: number | null;
          script_id?: string;
          style_profile_id?: string | null;
          style_profile_version?: number | null;
          template_version?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "script_versions_packet_id_fkey";
            columns: ["packet_id"];
            isOneToOne: false;
            referencedRelation: "research_packets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "script_versions_script_id_fkey";
            columns: ["script_id"];
            isOneToOne: false;
            referencedRelation: "scripts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "script_versions_style_profile_id_fkey";
            columns: ["style_profile_id"];
            isOneToOne: false;
            referencedRelation: "script_style_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      scripts: {
        Row: {
          user_id: string;
          approved_at: string | null;
          audit_status: string;
          audited_body_hash: string | null;
          body: string | null;
          body_hash: string | null;
          company_id: string;
          company_ids: string[];
          composition_id: string | null;
          created_at: string;
          created_by: string | null;
          estimated_duration_sec: number;
          format: string;
          generated_at: string | null;
          generation_meta: Json;
          id: string;
          is_ai_placeholder: boolean;
          is_multi_stock: boolean;
          language: string;
          last_audit_id: string | null;
          last_repair_id: string | null;
          model: string | null;
          packet_id: string | null;
          ready_for_review: boolean;
          rejected_reason: string | null;
          research_packet_version: number | null;
          series_key: string | null;
          series_part: number | null;
          status: string;
          story_id: string | null;
          style_profile_id: string | null;
          style_profile_version: number | null;
          style_quality_status: string | null;
          target_duration: string | null;
          template_version: string;
          title: string | null;
          tone: string | null;
          updated_at: string;
          word_count: number;
        };
        Insert: {
          user_id?: string;
          approved_at?: string | null;
          audit_status?: string;
          audited_body_hash?: string | null;
          body?: string | null;
          body_hash?: string | null;
          company_id: string;
          company_ids?: string[];
          composition_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          estimated_duration_sec?: number;
          format: string;
          generated_at?: string | null;
          generation_meta?: Json;
          id?: string;
          is_ai_placeholder?: boolean;
          is_multi_stock?: boolean;
          language?: string;
          last_audit_id?: string | null;
          last_repair_id?: string | null;
          model?: string | null;
          packet_id?: string | null;
          ready_for_review?: boolean;
          rejected_reason?: string | null;
          research_packet_version?: number | null;
          series_key?: string | null;
          series_part?: number | null;
          status?: string;
          story_id?: string | null;
          style_profile_id?: string | null;
          style_profile_version?: number | null;
          style_quality_status?: string | null;
          target_duration?: string | null;
          template_version?: string;
          title?: string | null;
          tone?: string | null;
          updated_at?: string;
          word_count?: number;
        };
        Update: {
          user_id?: string;
          approved_at?: string | null;
          audit_status?: string;
          audited_body_hash?: string | null;
          body?: string | null;
          body_hash?: string | null;
          company_id?: string;
          company_ids?: string[];
          composition_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          estimated_duration_sec?: number;
          format?: string;
          generated_at?: string | null;
          generation_meta?: Json;
          id?: string;
          is_ai_placeholder?: boolean;
          is_multi_stock?: boolean;
          language?: string;
          last_audit_id?: string | null;
          last_repair_id?: string | null;
          model?: string | null;
          packet_id?: string | null;
          ready_for_review?: boolean;
          rejected_reason?: string | null;
          research_packet_version?: number | null;
          series_key?: string | null;
          series_part?: number | null;
          status?: string;
          story_id?: string | null;
          style_profile_id?: string | null;
          style_profile_version?: number | null;
          style_quality_status?: string | null;
          target_duration?: string | null;
          template_version?: string;
          title?: string | null;
          tone?: string | null;
          updated_at?: string;
          word_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "scripts_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scripts_composition_id_fkey";
            columns: ["composition_id"];
            isOneToOne: false;
            referencedRelation: "content_compositions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scripts_packet_id_fkey";
            columns: ["packet_id"];
            isOneToOne: false;
            referencedRelation: "research_packets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scripts_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scripts_style_profile_id_fkey";
            columns: ["style_profile_id"];
            isOneToOne: false;
            referencedRelation: "script_style_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      sec_facts: {
        Row: {
          user_id: string;
          accession_number: string | null;
          candidate_concepts: Json;
          cik: string;
          company_id: string | null;
          concept: string;
          created_at: string;
          created_by: string | null;
          data_mode: string;
          end_date: string | null;
          filed: string | null;
          fiscal_period: string | null;
          fiscal_year: number | null;
          form: string | null;
          frame: string | null;
          id: string;
          ingestion_run_id: string | null;
          mapping_confidence: string;
          metric_key: string;
          period_kind: string;
          retrieved_at: string;
          start_date: string | null;
          taxonomy: string;
          unit: string;
          updated_at: string;
          value: number | null;
        };
        Insert: {
          user_id?: string;
          accession_number?: string | null;
          candidate_concepts?: Json;
          cik: string;
          company_id?: string | null;
          concept: string;
          created_at?: string;
          created_by?: string | null;
          data_mode?: string;
          end_date?: string | null;
          filed?: string | null;
          fiscal_period?: string | null;
          fiscal_year?: number | null;
          form?: string | null;
          frame?: string | null;
          id?: string;
          ingestion_run_id?: string | null;
          mapping_confidence?: string;
          metric_key: string;
          period_kind?: string;
          retrieved_at?: string;
          start_date?: string | null;
          taxonomy: string;
          unit: string;
          updated_at?: string;
          value?: number | null;
        };
        Update: {
          user_id?: string;
          accession_number?: string | null;
          candidate_concepts?: Json;
          cik?: string;
          company_id?: string | null;
          concept?: string;
          created_at?: string;
          created_by?: string | null;
          data_mode?: string;
          end_date?: string | null;
          filed?: string | null;
          fiscal_period?: string | null;
          fiscal_year?: number | null;
          form?: string | null;
          frame?: string | null;
          id?: string;
          ingestion_run_id?: string | null;
          mapping_confidence?: string;
          metric_key?: string;
          period_kind?: string;
          retrieved_at?: string;
          start_date?: string | null;
          taxonomy?: string;
          unit?: string;
          updated_at?: string;
          value?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "sec_facts_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      sec_filings: {
        Row: {
          user_id: string;
          accepted_at: string | null;
          accession_number: string;
          cik: string;
          company_id: string | null;
          created_at: string;
          created_by: string | null;
          data_mode: string;
          event_id: string | null;
          filing_date: string | null;
          filing_items: Json;
          form: string;
          id: string;
          ingestion_run_id: string | null;
          items_extracted_at: string | null;
          primary_document: string | null;
          report_date: string | null;
          retrieved_at: string;
          source_id: string | null;
          updated_at: string;
          url: string | null;
        };
        Insert: {
          user_id?: string;
          accepted_at?: string | null;
          accession_number: string;
          cik: string;
          company_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          data_mode?: string;
          event_id?: string | null;
          filing_date?: string | null;
          filing_items?: Json;
          form: string;
          id?: string;
          ingestion_run_id?: string | null;
          items_extracted_at?: string | null;
          primary_document?: string | null;
          report_date?: string | null;
          retrieved_at?: string;
          source_id?: string | null;
          updated_at?: string;
          url?: string | null;
        };
        Update: {
          user_id?: string;
          accepted_at?: string | null;
          accession_number?: string;
          cik?: string;
          company_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          data_mode?: string;
          event_id?: string | null;
          filing_date?: string | null;
          filing_items?: Json;
          form?: string;
          id?: string;
          ingestion_run_id?: string | null;
          items_extracted_at?: string | null;
          primary_document?: string | null;
          report_date?: string | null;
          retrieved_at?: string;
          source_id?: string | null;
          updated_at?: string;
          url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "sec_filings_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sec_filings_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sec_filings_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "sources";
            referencedColumns: ["id"];
          },
        ];
      };
      sec_ticker_cik: {
        Row: {
          cik: string;
          created_at: string;
          id: string;
          refreshed_at: string;
          ticker: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          cik: string;
          created_at?: string;
          id?: string;
          refreshed_at?: string;
          ticker: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          cik?: string;
          created_at?: string;
          id?: string;
          refreshed_at?: string;
          ticker?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      sentiment_snapshots: {
        Row: {
          user_id: string;
          category: string;
          company_id: string;
          confidence: number | null;
          created_at: string;
          created_by: string | null;
          evidence: string | null;
          id: string;
          is_demo: boolean;
          observed_at: string;
          rating: string;
          source_id: string | null;
          story_id: string | null;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          category?: string;
          company_id: string;
          confidence?: number | null;
          created_at?: string;
          created_by?: string | null;
          evidence?: string | null;
          id?: string;
          is_demo?: boolean;
          observed_at?: string;
          rating?: string;
          source_id?: string | null;
          story_id?: string | null;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          category?: string;
          company_id?: string;
          confidence?: number | null;
          created_at?: string;
          created_by?: string | null;
          evidence?: string | null;
          id?: string;
          is_demo?: boolean;
          observed_at?: string;
          rating?: string;
          source_id?: string | null;
          story_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sentiment_snapshots_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sentiment_snapshots_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "sources";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sentiment_snapshots_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      sources: {
        Row: {
          user_id: string;
          ai_summary: string | null;
          canonical_url: string | null;
          company_id: string | null;
          created_at: string;
          created_by: string | null;
          discovered_via: string;
          discovery_query: string | null;
          id: string;
          notes: string | null;
          published_at: string | null;
          publisher: string | null;
          retrieved_at: string;
          source_tier: string;
          source_type: string;
          story_id: string | null;
          title: string;
          updated_at: string;
          url: string | null;
        };
        Insert: {
          user_id?: string;
          ai_summary?: string | null;
          canonical_url?: string | null;
          company_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          discovered_via?: string;
          discovery_query?: string | null;
          id?: string;
          notes?: string | null;
          published_at?: string | null;
          publisher?: string | null;
          retrieved_at?: string;
          source_tier?: string;
          source_type?: string;
          story_id?: string | null;
          title: string;
          updated_at?: string;
          url?: string | null;
        };
        Update: {
          user_id?: string;
          ai_summary?: string | null;
          canonical_url?: string | null;
          company_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          discovered_via?: string;
          discovery_query?: string | null;
          id?: string;
          notes?: string | null;
          published_at?: string | null;
          publisher?: string | null;
          retrieved_at?: string;
          source_tier?: string;
          source_type?: string;
          story_id?: string | null;
          title?: string;
          updated_at?: string;
          url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "sources_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sources_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      stories: {
        Row: {
          user_id: string;
          candidate_id: string | null;
          company_id: string;
          content_opportunity_score: number | null;
          content_status: string;
          created_at: string;
          created_by: string | null;
          daily_change_pct: number | null;
          description: string | null;
          discovery_run_id: string | null;
          event_at: string | null;
          id: string;
          is_demo: boolean;
          pipeline_run_id: string | null;
          price: number | null;
          price_at: string | null;
          primary_catalyst: string | null;
          priority: string;
          promotion_source: string;
          status: string;
          story_type: string;
          title: string;
          updated_at: string;
          verification_score: number | null;
          volume_ratio: number | null;
        };
        Insert: {
          user_id?: string;
          candidate_id?: string | null;
          company_id: string;
          content_opportunity_score?: number | null;
          content_status?: string;
          created_at?: string;
          created_by?: string | null;
          daily_change_pct?: number | null;
          description?: string | null;
          discovery_run_id?: string | null;
          event_at?: string | null;
          id?: string;
          is_demo?: boolean;
          pipeline_run_id?: string | null;
          price?: number | null;
          price_at?: string | null;
          primary_catalyst?: string | null;
          priority?: string;
          promotion_source?: string;
          status?: string;
          story_type?: string;
          title: string;
          updated_at?: string;
          verification_score?: number | null;
          volume_ratio?: number | null;
        };
        Update: {
          user_id?: string;
          candidate_id?: string | null;
          company_id?: string;
          content_opportunity_score?: number | null;
          content_status?: string;
          created_at?: string;
          created_by?: string | null;
          daily_change_pct?: number | null;
          description?: string | null;
          discovery_run_id?: string | null;
          event_at?: string | null;
          id?: string;
          is_demo?: boolean;
          pipeline_run_id?: string | null;
          price?: number | null;
          price_at?: string | null;
          primary_catalyst?: string | null;
          priority?: string;
          promotion_source?: string;
          status?: string;
          story_type?: string;
          title?: string;
          updated_at?: string;
          verification_score?: number | null;
          volume_ratio?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "stories_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "story_candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stories_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stories_discovery_run_id_fkey";
            columns: ["discovery_run_id"];
            isOneToOne: false;
            referencedRelation: "discovery_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      story_candidates: {
        Row: {
          user_id: string;
          activity_note: string | null;
          ai_evaluated: boolean;
          best_source_tier: string | null;
          candidate_types: string[];
          catalyst: string | null;
          cluster_key: string;
          company_id: string | null;
          company_name: string;
          content_score: number;
          core_question: string | null;
          coverage_flag: string;
          created_at: string;
          created_by: string | null;
          discovered_at: string;
          discovery_reason: string;
          discovery_run_id: string | null;
          dismissed_reason: string | null;
          evaluation_notes: string | null;
          event_at: string | null;
          exchange: string | null;
          headline: string | null;
          id: string;
          market: string;
          pre_score: number;
          price_move_at: string | null;
          price_move_pct: number | null;
          price_move_source: string | null;
          primary_type: string;
          priority_band: string;
          promoted_at: string | null;
          provider_timestamp: string | null;
          reported_price_move_pct: number | null;
          score_coverage_pct: number;
          score_rank: number | null;
          signal_count: number;
          signals: Json;
          status: string;
          story_id: string | null;
          suggested_angle: string | null;
          suggested_hook: string | null;
          ticker: string | null;
          title: string;
          updated_at: string;
          url: string | null;
          volume: number | null;
          volume_ratio: number | null;
          week52_event: string | null;
        };
        Insert: {
          user_id?: string;
          activity_note?: string | null;
          ai_evaluated?: boolean;
          best_source_tier?: string | null;
          candidate_types?: string[];
          catalyst?: string | null;
          cluster_key: string;
          company_id?: string | null;
          company_name: string;
          content_score?: number;
          core_question?: string | null;
          coverage_flag?: string;
          created_at?: string;
          created_by?: string | null;
          discovered_at?: string;
          discovery_reason?: string;
          discovery_run_id?: string | null;
          dismissed_reason?: string | null;
          evaluation_notes?: string | null;
          event_at?: string | null;
          exchange?: string | null;
          headline?: string | null;
          id?: string;
          market: string;
          pre_score?: number;
          price_move_at?: string | null;
          price_move_pct?: number | null;
          price_move_source?: string | null;
          primary_type?: string;
          priority_band?: string;
          promoted_at?: string | null;
          provider_timestamp?: string | null;
          reported_price_move_pct?: number | null;
          score_coverage_pct?: number;
          score_rank?: number | null;
          signal_count?: number;
          signals?: Json;
          status?: string;
          story_id?: string | null;
          suggested_angle?: string | null;
          suggested_hook?: string | null;
          ticker?: string | null;
          title: string;
          updated_at?: string;
          url?: string | null;
          volume?: number | null;
          volume_ratio?: number | null;
          week52_event?: string | null;
        };
        Update: {
          user_id?: string;
          activity_note?: string | null;
          ai_evaluated?: boolean;
          best_source_tier?: string | null;
          candidate_types?: string[];
          catalyst?: string | null;
          cluster_key?: string;
          company_id?: string | null;
          company_name?: string;
          content_score?: number;
          core_question?: string | null;
          coverage_flag?: string;
          created_at?: string;
          created_by?: string | null;
          discovered_at?: string;
          discovery_reason?: string;
          discovery_run_id?: string | null;
          dismissed_reason?: string | null;
          evaluation_notes?: string | null;
          event_at?: string | null;
          exchange?: string | null;
          headline?: string | null;
          id?: string;
          market?: string;
          pre_score?: number;
          price_move_at?: string | null;
          price_move_pct?: number | null;
          price_move_source?: string | null;
          primary_type?: string;
          priority_band?: string;
          promoted_at?: string | null;
          provider_timestamp?: string | null;
          reported_price_move_pct?: number | null;
          score_coverage_pct?: number;
          score_rank?: number | null;
          signal_count?: number;
          signals?: Json;
          status?: string;
          story_id?: string | null;
          suggested_angle?: string | null;
          suggested_hook?: string | null;
          ticker?: string | null;
          title?: string;
          updated_at?: string;
          url?: string | null;
          volume?: number | null;
          volume_ratio?: number | null;
          week52_event?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "story_candidates_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_candidates_discovery_run_id_fkey";
            columns: ["discovery_run_id"];
            isOneToOne: false;
            referencedRelation: "discovery_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_candidates_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      technical_metrics: {
        Row: {
          user_id: string;
          as_of: string;
          atr: number | null;
          avg_volume_20d: number | null;
          company_id: string;
          created_at: string;
          created_by: string | null;
          current_volume: number | null;
          gap_levels: number[];
          high_52w: number | null;
          id: string;
          interpretation: string | null;
          is_demo: boolean;
          low_52w: number | null;
          ma_20: number | null;
          ma_200: number | null;
          ma_50: number | null;
          relative_strength: number | null;
          resistance_levels: number[];
          rsi: number | null;
          support_levels: number[];
          trend: string | null;
          updated_at: string;
          volume_ratio: number | null;
        };
        Insert: {
          user_id?: string;
          as_of?: string;
          atr?: number | null;
          avg_volume_20d?: number | null;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          current_volume?: number | null;
          gap_levels?: number[];
          high_52w?: number | null;
          id?: string;
          interpretation?: string | null;
          is_demo?: boolean;
          low_52w?: number | null;
          ma_20?: number | null;
          ma_200?: number | null;
          ma_50?: number | null;
          relative_strength?: number | null;
          resistance_levels?: number[];
          rsi?: number | null;
          support_levels?: number[];
          trend?: string | null;
          updated_at?: string;
          volume_ratio?: number | null;
        };
        Update: {
          user_id?: string;
          as_of?: string;
          atr?: number | null;
          avg_volume_20d?: number | null;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          current_volume?: number | null;
          gap_levels?: number[];
          high_52w?: number | null;
          id?: string;
          interpretation?: string | null;
          is_demo?: boolean;
          low_52w?: number | null;
          ma_20?: number | null;
          ma_200?: number | null;
          ma_50?: number | null;
          relative_strength?: number | null;
          resistance_levels?: number[];
          rsi?: number | null;
          support_levels?: number[];
          trend?: string | null;
          updated_at?: string;
          volume_ratio?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "technical_metrics_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      universe_members: {
        Row: {
          user_id: string;
          company_id: string | null;
          computed_at: string;
          created_at: string;
          exchange: string | null;
          id: string;
          is_active: boolean;
          market: string;
          name: string;
          rank: number | null;
          reason: string | null;
          score: number | null;
          sector: string | null;
          ticker: string;
          tier: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          company_id?: string | null;
          computed_at?: string;
          created_at?: string;
          exchange?: string | null;
          id?: string;
          is_active?: boolean;
          market: string;
          name: string;
          rank?: number | null;
          reason?: string | null;
          score?: number | null;
          sector?: string | null;
          ticker: string;
          tier: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          company_id?: string | null;
          computed_at?: string;
          created_at?: string;
          exchange?: string | null;
          id?: string;
          is_active?: boolean;
          market?: string;
          name?: string;
          rank?: number | null;
          reason?: string | null;
          score?: number | null;
          sector?: string | null;
          ticker?: string;
          tier?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "universe_members_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      valuations: {
        Row: {
          user_id: string;
          as_of: string;
          classification: string | null;
          company_id: string;
          created_at: string;
          created_by: string | null;
          dividend_yield: number | null;
          ev_ebitda: number | null;
          ev_sales: number | null;
          explanation: string | null;
          fcf_yield: number | null;
          forward_pe: number | null;
          hist_3y: Json;
          hist_5y: Json;
          id: string;
          is_demo: boolean;
          peer_median: Json;
          peg: number | null;
          price_book: number | null;
          price_sales: number | null;
          trailing_pe: number | null;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          as_of?: string;
          classification?: string | null;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          dividend_yield?: number | null;
          ev_ebitda?: number | null;
          ev_sales?: number | null;
          explanation?: string | null;
          fcf_yield?: number | null;
          forward_pe?: number | null;
          hist_3y?: Json;
          hist_5y?: Json;
          id?: string;
          is_demo?: boolean;
          peer_median?: Json;
          peg?: number | null;
          price_book?: number | null;
          price_sales?: number | null;
          trailing_pe?: number | null;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          as_of?: string;
          classification?: string | null;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          dividend_yield?: number | null;
          ev_ebitda?: number | null;
          ev_sales?: number | null;
          explanation?: string | null;
          fcf_yield?: number | null;
          forward_pe?: number | null;
          hist_3y?: Json;
          hist_5y?: Json;
          id?: string;
          is_demo?: boolean;
          peer_median?: Json;
          peg?: number | null;
          price_book?: number | null;
          price_sales?: number | null;
          trailing_pe?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "valuations_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      watchlist_items: {
        Row: {
          user_id: string;
          company_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          notes: string | null;
          priority: string;
          tags: string[];
          updated_at: string;
          watchlist_id: string;
        };
        Insert: {
          user_id?: string;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          notes?: string | null;
          priority?: string;
          tags?: string[];
          updated_at?: string;
          watchlist_id: string;
        };
        Update: {
          user_id?: string;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          notes?: string | null;
          priority?: string;
          tags?: string[];
          updated_at?: string;
          watchlist_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "watchlist_items_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "watchlist_items_watchlist_id_fkey";
            columns: ["watchlist_id"];
            isOneToOne: false;
            referencedRelation: "watchlists";
            referencedColumns: ["id"];
          },
        ];
      };
      watchlists: {
        Row: {
          user_id: string;
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          is_default: boolean;
          name: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_default?: boolean;
          name: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_default?: boolean;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      web_research_runs: {
        Row: {
          user_id: string;
          analyst_views: number;
          claims_added: number;
          company_id: string | null;
          confirmations: number;
          conflicts: number;
          created_at: string;
          created_by: string | null;
          delta_summary: string | null;
          error: string | null;
          estimated_cost_usd: number;
          id: string;
          model: string | null;
          ok: boolean;
          packet_id: string | null;
          queries: Json;
          sources_duplicate: number;
          sources_found: number;
          sources_new: number;
          story_id: string | null;
          unresolved_questions: Json;
          web_search_calls: number;
        };
        Insert: {
          user_id?: string;
          analyst_views?: number;
          claims_added?: number;
          company_id?: string | null;
          confirmations?: number;
          conflicts?: number;
          created_at?: string;
          created_by?: string | null;
          delta_summary?: string | null;
          error?: string | null;
          estimated_cost_usd?: number;
          id?: string;
          model?: string | null;
          ok?: boolean;
          packet_id?: string | null;
          queries?: Json;
          sources_duplicate?: number;
          sources_found?: number;
          sources_new?: number;
          story_id?: string | null;
          unresolved_questions?: Json;
          web_search_calls?: number;
        };
        Update: {
          user_id?: string;
          analyst_views?: number;
          claims_added?: number;
          company_id?: string | null;
          confirmations?: number;
          conflicts?: number;
          created_at?: string;
          created_by?: string | null;
          delta_summary?: string | null;
          error?: string | null;
          estimated_cost_usd?: number;
          id?: string;
          model?: string | null;
          ok?: boolean;
          packet_id?: string | null;
          queries?: Json;
          sources_duplicate?: number;
          sources_found?: number;
          sources_new?: number;
          story_id?: string | null;
          unresolved_questions?: Json;
          web_search_calls?: number;
        };
        Relationships: [
          {
            foreignKeyName: "web_research_runs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "web_research_runs_packet_id_fkey";
            columns: ["packet_id"];
            isOneToOne: false;
            referencedRelation: "research_packets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "web_research_runs_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      is_installation_owner: { Args: Record<PropertyKey, never>; Returns: boolean };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
