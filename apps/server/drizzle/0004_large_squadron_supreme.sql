CREATE TABLE `provider_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`stt_provider` text,
	`stt_base_url` text,
	`stt_model` text,
	`stt_api_key_enc` text,
	`llm_provider` text,
	`llm_base_url` text,
	`llm_model` text,
	`llm_api_key_enc` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rambles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`audio_path` text,
	`audio_mime` text NOT NULL,
	`audio_bytes` integer NOT NULL,
	`duration_sec` real,
	`transcript` text,
	`extracted_json` text,
	`error` text,
	`failed_stage` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rambles_user_id_idx` ON `rambles` (`user_id`);