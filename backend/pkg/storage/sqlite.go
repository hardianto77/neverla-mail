package storage

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strings"

	_ "github.com/mattn/go-sqlite3"
)

type Message struct {
	ID              string    `json:"id"`
	Address         string    `json:"address"`
	Alias           string    `json:"alias"`
	FromEmail       string    `json:"from"`
	FromName        string    `json:"from_name"`
	ToEmail         string    `json:"to"`
	Subject         string    `json:"subject"`
	Date            string    `json:"date"`
	Seen            bool      `json:"seen"`
	Text            string    `json:"text"`
	TextDerived     bool      `json:"text_derived"`
	HTML            string    `json:"html"`
	AttachmentsJSON string    `json:"-"`
	Attachments     []string  `json:"attachments"`
	ExpiresAt       string    `json:"expires_at"`
	CreatedAt       int64     `json:"created_at"`
}

type DB struct {
	db *sql.DB
}

func NewDB(dbPath string) (*DB, error) {
	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}

	schema := `
	CREATE TABLE IF NOT EXISTS messages (
		id TEXT PRIMARY KEY,
		address TEXT NOT NULL,
		alias TEXT,
		from_email TEXT NOT NULL,
		from_name TEXT,
		to_email TEXT NOT NULL,
		subject TEXT,
		date TEXT NOT NULL,
		seen INTEGER DEFAULT 0,
		text TEXT,
		text_derived INTEGER DEFAULT 0,
		html TEXT,
		attachments_json TEXT DEFAULT '[]',
		expires_at TEXT NOT NULL,
		created_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_messages_address ON messages(address);
	CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
	`
	if _, err := db.Exec(schema); err != nil {
		return nil, err
	}

	return &DB{db: db}, nil
}

func (d *DB) GetAlias(address string) string {
	norm := strings.TrimSpace(strings.ToLower(address))
	hasher := sha256.New()
	hasher.Write([]byte(norm + ":neverla-salt"))
	hash := hex.EncodeToString(hasher.Sum(nil))
	return fmt.Sprintf("%s@uvorion.com", hash[:12])
}

func (d *DB) SaveMessage(msg *Message) error {
	query := `INSERT OR REPLACE INTO messages (
		id, address, alias, from_email, from_name, to_email, subject, date, seen, text, text_derived, html, attachments_json, expires_at, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

	seenInt := 0
	if msg.Seen {
		seenInt = 1
	}
	derivedInt := 0
	if msg.TextDerived {
		derivedInt = 1
	}

	_, err := d.db.Exec(query,
		msg.ID, msg.Address, msg.Alias, msg.FromEmail, msg.FromName, msg.ToEmail,
		msg.Subject, msg.Date, seenInt, msg.Text, derivedInt, msg.HTML,
		msg.AttachmentsJSON, msg.ExpiresAt, msg.CreatedAt,
	)
	return err
}

func (d *DB) GetMailbox(address string, limit int, before int64) ([]Message, error) {
	norm := strings.TrimSpace(strings.ToLower(address))
	query := `SELECT id, address, alias, from_email, from_name, to_email, subject, date, seen, text, text_derived, html, attachments_json, expires_at, created_at FROM messages WHERE address = ?`
	args := []interface{}{norm}

	if before > 0 {
		query += ` AND created_at < ?`
		args = append(args, before)
	}
	query += ` ORDER BY created_at DESC LIMIT ?`
	args = append(args, limit)

	rows, err := d.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []Message
	for rows.Next() {
		var m Message
		var seenInt, derivedInt int
		var alias, fromName, subject, text, html sql.NullString

		err := rows.Scan(
			&m.ID, &m.Address, &alias, &m.FromEmail, &fromName, &m.ToEmail,
			&subject, &m.Date, &seenInt, &text, &derivedInt, &html,
			&m.AttachmentsJSON, &m.ExpiresAt, &m.CreatedAt,
		)
		if err != nil {
			return nil, err
		}

		m.Alias = alias.String
		m.FromName = fromName.String
		m.Subject = subject.String
		m.Text = text.String
		m.HTML = html.String
		m.Seen = (seenInt == 1)
		m.TextDerived = (derivedInt == 1)
		m.Attachments = []string{}

		list = append(list, m)
	}
	return list, nil
}

func (d *DB) GetMessageByID(id string) (*Message, error) {
	query := `SELECT id, address, alias, from_email, from_name, to_email, subject, date, seen, text, text_derived, html, attachments_json, expires_at, created_at FROM messages WHERE id = ?`
	row := d.db.QueryRow(query, id)

	var m Message
	var seenInt, derivedInt int
	var alias, fromName, subject, text, html sql.NullString

	err := row.Scan(
		&m.ID, &m.Address, &alias, &m.FromEmail, &fromName, &m.ToEmail,
		&subject, &m.Date, &seenInt, &text, &derivedInt, &html,
		&m.AttachmentsJSON, &m.ExpiresAt, &m.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	m.Alias = alias.String
	m.FromName = fromName.String
	m.Subject = subject.String
	m.Text = text.String
	m.HTML = html.String
	m.Seen = true
	m.TextDerived = (derivedInt == 1)
	m.Attachments = []string{}

	// Mark as seen
	d.db.Exec(`UPDATE messages SET seen = 1 WHERE id = ?`, id)

	return &m, nil
}

func (d *DB) DeleteMessage(id string) error {
	_, err := d.db.Exec(`DELETE FROM messages WHERE id = ?`, id)
	return err
}
