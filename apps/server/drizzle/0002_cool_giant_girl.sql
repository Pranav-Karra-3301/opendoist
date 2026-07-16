ALTER TABLE `two_factor` ADD `verified` integer DEFAULT true;--> statement-breakpoint
ALTER TABLE `two_factor` ADD `failed_verification_count` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `two_factor` ADD `locked_until` integer;