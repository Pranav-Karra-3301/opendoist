CREATE VIRTUAL TABLE tasks_fts USING fts5(content, description, content='tasks', content_rowid='rowid');
--> statement-breakpoint
CREATE TRIGGER tasks_fts_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(rowid, content, description) VALUES (new.rowid, new.content, new.description);
END;
--> statement-breakpoint
CREATE TRIGGER tasks_fts_ad AFTER DELETE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, content, description) VALUES ('delete', old.rowid, old.content, old.description);
END;
--> statement-breakpoint
CREATE TRIGGER tasks_fts_au AFTER UPDATE OF content, description ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, content, description) VALUES ('delete', old.rowid, old.content, old.description);
  INSERT INTO tasks_fts(rowid, content, description) VALUES (new.rowid, new.content, new.description);
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE comments_fts USING fts5(content, content='comments', content_rowid='rowid');
--> statement-breakpoint
CREATE TRIGGER comments_fts_ai AFTER INSERT ON comments BEGIN
  INSERT INTO comments_fts(rowid, content) VALUES (new.rowid, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER comments_fts_ad AFTER DELETE ON comments BEGIN
  INSERT INTO comments_fts(comments_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
--> statement-breakpoint
CREATE TRIGGER comments_fts_au AFTER UPDATE OF content ON comments BEGIN
  INSERT INTO comments_fts(comments_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO comments_fts(rowid, content) VALUES (new.rowid, new.content);
END;
