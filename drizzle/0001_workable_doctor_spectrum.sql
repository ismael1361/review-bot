CREATE TABLE `pr_seen` (
	`repository_id` text NOT NULL,
	`pr_number` integer NOT NULL,
	`last_updated_at` integer NOT NULL,
	`last_head_sha` text NOT NULL,
	PRIMARY KEY(`repository_id`, `pr_number`),
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `jobs` ADD `summary_md` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `next_attempt_at` integer;--> statement-breakpoint
ALTER TABLE `review_findings` ADD `snippet_json` text;