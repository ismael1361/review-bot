CREATE TABLE `agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`seq` integer NOT NULL,
	`role` text NOT NULL,
	`content_json` text NOT NULL,
	`tool_name` text,
	`tokens_in` integer,
	`tokens_out` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_messages_job_seq` ON `agent_messages` (`job_id`,`seq`);--> statement-breakpoint
CREATE TABLE `ai_profile_skills` (
	`profile_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `skill_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `ai_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ai_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`base_url` text NOT NULL,
	`model` text NOT NULL,
	`api_key_encrypted` text NOT NULL,
	`temperature` real NOT NULL,
	`max_output_tokens` integer NOT NULL,
	`max_turns` integer NOT NULL,
	`max_total_tokens` integer NOT NULL,
	`max_duration_sec` integer NOT NULL,
	`max_findings` integer NOT NULL,
	`max_github_calls` integer NOT NULL,
	`pre_prompt` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_profiles_name_unique` ON `ai_profiles` (`name`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`data_json` text,
	`ip` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_created` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text,
	`level` text NOT NULL,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`data_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_job_created` ON `events` (`job_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `github_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`etag` text NOT NULL,
	`payload_json` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `github_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`login` text NOT NULL,
	`pat_encrypted` text NOT NULL,
	`pat_last4` text NOT NULL,
	`scopes` text,
	`validated_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`pr_number` integer NOT NULL,
	`pr_title` text NOT NULL,
	`pr_url` text NOT NULL,
	`author_login` text NOT NULL,
	`head_sha` text NOT NULL,
	`base_sha` text NOT NULL,
	`run_seq` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`profile_id` text,
	`profile_snapshot_json` text,
	`queued_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`heartbeat_at` integer,
	`locked_by` text,
	`error_code` text,
	`error_message` text,
	`usage_json` text,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`profile_id`) REFERENCES `ai_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_unique_run` ON `jobs` (`repository_id`,`pr_number`,`head_sha`,`run_seq`);--> statement-breakpoint
CREATE INDEX `jobs_status_queued` ON `jobs` (`status`,`queued_at`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`github_id` text NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`full_name` text NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`discovered_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_github_id_unique` ON `repositories` (`github_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_full_name_unique` ON `repositories` (`full_name`);--> statement-breakpoint
CREATE TABLE `review_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`review_id` text,
	`path` text NOT NULL,
	`start_line` integer,
	`end_line` integer,
	`side` text DEFAULT 'RIGHT' NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`body_md` text NOT NULL,
	`suggestion_md` text,
	`status` text NOT NULL,
	`github_comment_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `findings_job_status` ON `review_findings` (`job_id`,`status`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`github_review_id` text,
	`url` text,
	`body` text NOT NULL,
	`event` text NOT NULL,
	`comments_posted` integer DEFAULT 0 NOT NULL,
	`comments_fallback` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`posted_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_job_unique` ON `reviews` (`job_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`idle_expires_at` integer NOT NULL,
	`absolute_expires_at` integer NOT NULL,
	`ip` text,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`content_md` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skills_name_unique` ON `skills` (`name`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`is_root` integer DEFAULT false NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_login_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`event` text NOT NULL,
	`success` integer NOT NULL,
	`status_code` integer,
	`attempt` integer NOT NULL,
	`response_excerpt` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_webhook_created` ON `webhook_deliveries` (`webhook_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`secret_encrypted` text NOT NULL,
	`events_json` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
