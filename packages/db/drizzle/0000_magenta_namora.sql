CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text DEFAULT 'New conversation' NOT NULL,
	"title_source" text DEFAULT 'default' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conv_status_check" CHECK ("conversations"."status" in ('active','archived')),
	CONSTRAINT "conv_title_source_check" CHECK ("conversations"."title_source" in ('default','auto','user'))
);
--> statement-breakpoint
CREATE TABLE "inference_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"user_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer,
	"time_to_first_token_ms" integer,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"input_preview" text,
	"output_preview" text,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"estimated_cost_usd" numeric(12, 6),
	"error_category" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inference_logs_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "logs_status_check" CHECK ("inference_logs"."status" in ('success','error','cancelled')),
	CONSTRAINT "logs_error_category_check" CHECK ("inference_logs"."error_category" is null or "inference_logs"."error_category" in ('rate_limit','timeout','auth','content_filter','other'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"token_count" integer,
	"sequence" integer NOT NULL,
	"status" text DEFAULT 'complete' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "msg_role_check" CHECK ("messages"."role" in ('user','assistant','system')),
	CONSTRAINT "msg_status_check" CHECK ("messages"."status" in ('complete','partial','error'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_logs" ADD CONSTRAINT "inference_logs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_logs" ADD CONSTRAINT "inference_logs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_logs" ADD CONSTRAINT "inference_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_conv_user_status_updated" ON "conversations" USING btree ("user_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "idx_logs_created" ON "inference_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_logs_prov_model" ON "inference_logs" USING btree ("provider","model");--> statement-breakpoint
CREATE INDEX "idx_logs_status" ON "inference_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_logs_conv" ON "inference_logs" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_msg_conv_seq" ON "messages" USING btree ("conversation_id","sequence");