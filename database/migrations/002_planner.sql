
CREATE TABLE IF NOT EXISTS academic_terms (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status ENUM('upcoming','active','completed','archived') NOT NULL DEFAULT 'upcoming',
  UNIQUE (user_id, id),
  INDEX (user_id, status),
  CHECK (end_date >= start_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS courses (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  term_id INT UNSIGNED NOT NULL,
  title VARCHAR(150) NOT NULL,
  code VARCHAR(40) NOT NULL,
  instructor VARCHAR(100),
  location VARCHAR(150),
  description TEXT,
  color VARCHAR(20),
  status ENUM('active','archived') NOT NULL DEFAULT 'active',
  UNIQUE (user_id, id),
  INDEX (user_id, status),
  FOREIGN KEY (user_id, term_id) REFERENCES academic_terms(user_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS course_schedules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  course_id INT UNSIGNED NOT NULL,
  weekday TINYINT UNSIGNED NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  location VARCHAR(150),
  CHECK (weekday BETWEEN 1 AND 7),
  CHECK (start_time >= '00:00:00' AND end_time < '24:00:00' AND end_time > start_time),
  FOREIGN KEY (user_id, course_id) REFERENCES courses(user_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tasks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  course_id INT UNSIGNED,
  title VARCHAR(150) NOT NULL,
  description TEXT,
  personal_notes TEXT,
  category ENUM('assignment','exam','quiz','reading','project','presentation','personal_study') NOT NULL,
  priority ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
  status ENUM('not_started','in_progress','completed','archived') NOT NULL DEFAULT 'not_started',
  due_at DATETIME(3),
  due_date DATE,
  target_at DATETIME(3),
  estimate_minutes INT UNSIGNED,
  completed_at DATETIME(3),
  UNIQUE (user_id, id),
  INDEX (user_id, status, due_at),
  INDEX (user_id, due_date),
  CHECK (due_at IS NULL OR due_date IS NULL),
  CHECK (status <> 'completed' OR completed_at IS NOT NULL),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, course_id) REFERENCES courses(user_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subtasks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  task_id INT UNSIGNED NOT NULL,
  title VARCHAR(150) NOT NULL,
  status ENUM('not_started','completed') NOT NULL DEFAULT 'not_started',
  position INT UNSIGNED NOT NULL,
  INDEX (user_id, task_id, position),
  FOREIGN KEY (user_id, task_id) REFERENCES tasks(user_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS study_sessions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  course_id INT UNSIGNED,
  task_id INT UNSIGNED,
  title VARCHAR(150) NOT NULL,
  start_at DATETIME(3) NOT NULL,
  end_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3),
  actual_minutes INT UNSIGNED,
  recurrence JSON,
  recurrence_end DATE,
  recurrence_count INT UNSIGNED,
  status ENUM('planned','in_progress','completed','cancelled') NOT NULL DEFAULT 'planned',
  UNIQUE (user_id, id),
  INDEX (user_id, start_at),
  INDEX (user_id, status),
  CHECK (end_at > start_at),
  CHECK (status <> 'completed' OR completed_at IS NOT NULL),
  CHECK ((recurrence IS NULL AND recurrence_end IS NULL AND recurrence_count IS NULL) OR
    (recurrence IS NOT NULL AND ((recurrence_end IS NOT NULL AND recurrence_count IS NULL) OR
    (recurrence_end IS NULL AND recurrence_count IS NOT NULL AND recurrence_count > 0)))),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, course_id) REFERENCES courses(user_id, id),
  FOREIGN KEY (user_id, task_id) REFERENCES tasks(user_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS availability_rules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  weekday TINYINT UNSIGNED NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  effective_from DATE,
  effective_until DATE,
  INDEX (user_id, weekday),
  CHECK (weekday BETWEEN 1 AND 7),
  CHECK (start_time >= '00:00:00' AND end_time < '24:00:00' AND end_time > start_time),
  CHECK (effective_until >= effective_from),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reminder_rules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  task_id INT UNSIGNED,
  session_id INT UNSIGNED,
  offset_minutes INT UNSIGNED NOT NULL,
  channel ENUM('in_app','email') NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (user_id, id),
  UNIQUE (user_id, task_id, offset_minutes, channel),
  UNIQUE (user_id, session_id, offset_minutes, channel),
  CHECK ((task_id IS NULL) <> (session_id IS NULL)),
  FOREIGN KEY (user_id, task_id) REFERENCES tasks(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, session_id) REFERENCES study_sessions(user_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notifications (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  reminder_id INT UNSIGNED NOT NULL,
  scheduled_at DATETIME(3) NOT NULL,
  status ENUM('scheduled','queued','sent','failed') NOT NULL DEFAULT 'scheduled',
  read_at DATETIME(3),
  UNIQUE (user_id, reminder_id, scheduled_at),
  INDEX (user_id, read_at, scheduled_at),
  INDEX (status, scheduled_at),
  FOREIGN KEY (user_id, reminder_id) REFERENCES reminder_rules(user_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
