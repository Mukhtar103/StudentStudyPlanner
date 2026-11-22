
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
  locale VARCHAR(40) NOT NULL DEFAULT 'en-US',
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id INT UNSIGNED PRIMARY KEY,
  reminder_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  email_notifications BOOLEAN NOT NULL DEFAULT FALSE,
  in_app_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_start TIME,
  quiet_end TIME,
  CHECK (reminder_minutes <= 10080),
  CHECK ((quiet_start IS NULL AND quiet_end IS NULL) OR (quiet_start IS NOT NULL AND quiet_end IS NOT NULL AND quiet_start <> quiet_end)),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash BINARY(32) PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  INDEX (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash BINARY(32) PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  INDEX (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED,
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(40) NOT NULL DEFAULT 'user',
  entity_id INT UNSIGNED,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  outcome ENUM('success','failure') NOT NULL,
  INDEX (user_id, occurred_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
