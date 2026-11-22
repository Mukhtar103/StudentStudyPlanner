ALTER TABLE reminder_rules
  ADD COLUMN created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  ADD COLUMN deleted_at DATETIME(3);
ALTER TABLE notifications
  ADD COLUMN source_id INT UNSIGNED,
  ADD COLUMN source_type ENUM('task','study'),
  ADD COLUMN channel ENUM('in_app','email') NOT NULL DEFAULT 'in_app',
  ADD COLUMN title VARCHAR(170),
  ADD COLUMN message VARCHAR(300),
  ADD COLUMN event_at DATETIME(3),
  ADD COLUMN delivered_at DATETIME(3),
  ADD COLUMN deleted_at DATETIME(3),
  ADD COLUMN retry_at DATETIME(3),
  ADD COLUMN attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN error_code VARCHAR(40),
  ADD INDEX notification_inbox (user_id,channel,status,deleted_at,read_at,scheduled_at),
  ADD INDEX notification_queue (status,retry_at),
  ADD UNIQUE (user_id,reminder_id,source_id,scheduled_at), DROP INDEX user_id;

