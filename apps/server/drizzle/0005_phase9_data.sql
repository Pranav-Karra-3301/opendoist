CREATE TABLE `backup_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`retention_days` integer,
	`include_attachments` integer
);
--> statement-breakpoint
CREATE TABLE `backups_meta` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`kind` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`includes_attachments` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backups_meta_filename_unique` ON `backups_meta` (`filename`);--> statement-breakpoint
CREATE TABLE `import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`progress` text NOT NULL,
	`report` text,
	`error` text,
	`created_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE TABLE `karma_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`at` text NOT NULL,
	`date` text NOT NULL,
	`reason` text NOT NULL,
	`task_id` text,
	`delta` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `karma_ledger_user_date` ON `karma_ledger` (`user_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `karma_ledger_goal_once` ON `karma_ledger` (`user_id`,`date`,`reason`) WHERE reason IN ('daily_goal','weekly_goal');--> statement-breakpoint
ALTER TABLE `day_stats` ADD `is_day_off` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `day_stats` ADD `is_vacation` integer DEFAULT false NOT NULL;