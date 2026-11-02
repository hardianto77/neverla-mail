package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

var (
	db       *sql.DB
	dbMutex  sync.RWMutex
	baseDir  = "/data/home/neverla-mail"
	dbPath   = filepath.Join(baseDir, "data", "mail.db")
	pubDir   = filepath.Join(baseDir, "public")
	port     = os.Getenv("PORT")
	domains  = []string{
		"neverla.web.id", "fldubai.com", "mynes.com", "hunnur.com", "binich.com",
		"vitahicks.com", "zeropolly.com", "rodhazlitt.com", "dripzgaming.com",
		"tshirtsavvy.com", "yopmail.com", "gmail.com", "googlemail.com",
		"grabmail.io", "linqmail.com", "mixozia.com", "devrungkad.biz.id", "zennext.biz.id",
	}
)

func initDB() {
	os.MkdirAll(filepath.Dir(dbPath), 0755)
	var err error
	db, err = sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		log.Fatalf("Failed to open SQLite: %v", err)
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS messages (
		id TEXT PRIMARY KEY,
		address TEXT NOT NULL,
		alias TEXT NOT NULL,
		from_address TEXT NOT NULL,
		subject TEXT NOT NULL,
		body_text TEXT,
		body_html TEXT,
		otp_code TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX IF NOT EXISTS idx_messages_address ON messages(address);
	CREATE INDEX IF NOT EXISTS idx_messages_alias ON messages(alias);
	`
	if _, err := db.Exec(createTable); err != nil {
		log.Fatalf("Failed to initialize schema: %v", err)
	}
}

func computeAlias(address string) string {
	h := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(address)) + "_neverla_salt_2026"))
	return hex.EncodeToString(h[:])[:12] + "@uvorion.com"
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// REST APIs
func handleDomains(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"domains": domains,
		"count":   len(domains),
	})
}

type MessageSummary struct {
	ID          string `json:"id"`
	FromAddress string `json:"from_address"`
	Subject     string `json:"subject"`
	OTPCode     string `json:"otp_code,omitempty"`
	CreatedAt   string `json:"created_at"`
}

func handleMailbox(w http.ResponseWriter, r *http.Request) {
	address := r.URL.Query().Get("address")
	if address == "" {
		address = r.URL.Query().Get("mailbox")
	}
	if address == "" {
		http.Error(w, `{"error":"Missing address parameter"}`, http.StatusBadRequest)
		return
	}

	alias := computeAlias(address)
	dbMutex.RLock()
	rows, err := db.Query("SELECT id, from_address, subject, otp_code, created_at FROM messages WHERE address = ? OR alias = ? ORDER BY created_at DESC", address, alias)
	dbMutex.RUnlock()

	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var list []MessageSummary
	for rows.Next() {
		var m MessageSummary
		var otp sql.NullString
		if err := rows.Scan(&m.ID, &m.FromAddress, &m.Subject, &otp, &m.CreatedAt); err == nil {
			if otp.Valid {
				m.OTPCode = otp.String
			}
			list = append(list, m)
		}
	}
	if list == nil {
		list = []MessageSummary{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"address":  address,
		"alias":    alias,
		"count":    len(list),
		"messages": list,
	})
}

func handleMessageDetail(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/v1/message/")
	id = strings.TrimPrefix(id, "/api/v1/message/")
	id = strings.TrimPrefix(id, "/gm-api/v1/message/")

	if id == "" {
		http.Error(w, `{"error":"Missing message id"}`, http.StatusBadRequest)
		return
	}

	dbMutex.RLock()
	var m struct {
		ID          string         `json:"id"`
		Address     string         `json:"address"`
		Alias       string         `json:"alias"`
		FromAddress string         `json:"from_address"`
		Subject     string         `json:"subject"`
		BodyText    sql.NullString `json:"body_text"`
		BodyHTML    sql.NullString `json:"body_html"`
		OTPCode     sql.NullString `json:"otp_code"`
		CreatedAt   string         `json:"created_at"`
	}
	err := db.QueryRow("SELECT id, address, alias, from_address, subject, body_text, body_html, otp_code, created_at FROM messages WHERE id = ?", id).Scan(
		&m.ID, &m.Address, &m.Alias, &m.FromAddress, &m.Subject, &m.BodyText, &m.BodyHTML, &m.OTPCode, &m.CreatedAt,
	)
	dbMutex.RUnlock()

	if err != nil {
		http.Error(w, `{"error":"Message not found"}`, http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":           m.ID,
		"address":      m.Address,
		"alias":        m.Alias,
		"from_address": m.FromAddress,
		"subject":      m.Subject,
		"body_text":    m.BodyText.String,
		"body_html":    m.BodyHTML.String,
		"otp_code":     m.OTPCode.String,
		"created_at":   m.CreatedAt,
	})
}

func handleSimulate(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	body, _ := io.ReadAll(r.Body)
	var req struct {
		Address  string `json:"address"`
		From     string `json:"from"`
		Subject  string `json:"subject"`
		BodyText string `json:"body_text"`
		BodyHTML string `json:"body_html"`
		OTPCode  string `json:"otp_code"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, `{"error":"Invalid payload"}`, http.StatusBadRequest)
		return
	}

	id := fmt.Sprintf("msg_%d", time.Now().UnixNano())
	alias := computeAlias(req.Address)

	dbMutex.Lock()
	query := "INSERT INTO messages (id, address, alias, from_address, subject, body_text, body_html, otp_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
	_, err := db.Exec(query, id, req.Address, alias, req.From, req.Subject, req.BodyText, req.BodyHTML, req.OTPCode)
	dbMutex.Unlock()

	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"id":      id,
		"address": req.Address,
		"alias":   alias,
	})
}

func servePage(filename string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(pubDir, filename))
	}
}

func main() {
	if port == "" {
		port = "3417"
	}

	initDB()
	log.Printf("Neverla Mail High-Performance Go Core starting on port %s...", port)

	mux := http.NewServeMux()

	// REST APIs
	mux.HandleFunc("/v1/domains", handleDomains)
	mux.HandleFunc("/api/v1/domains", handleDomains)
	mux.HandleFunc("/gm-api/v1/domains", handleDomains)

	mux.HandleFunc("/v1/mailbox", handleMailbox)
	mux.HandleFunc("/api/v1/mailbox", handleMailbox)
	mux.HandleFunc("/gm-api/v1/mailbox", handleMailbox)

	mux.HandleFunc("/v1/message/", handleMessageDetail)
	mux.HandleFunc("/api/v1/message/", handleMessageDetail)
	mux.HandleFunc("/gm-api/v1/message/", handleMessageDetail)

	mux.HandleFunc("/v1/simulate", handleSimulate)

	// GrabMail Cloned Pages
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.ServeFile(w, r, filepath.Join(pubDir, "index.html"))
			return
		}
		// Static assets
		filePath := filepath.Join(pubDir, r.URL.Path)
		if fi, err := os.Stat(filePath); err == nil && !fi.IsDir() {
			http.ServeFile(w, r, filePath)
			return
		}
		// If unknown route, fallback to index
		http.ServeFile(w, r, filepath.Join(pubDir, "index.html"))
	})

	mux.HandleFunc("/inbox", servePage("inbox.html"))
	mux.HandleFunc("/domains", servePage("domains.html"))
	mux.HandleFunc("/pricing", servePage("pricing.html"))
	mux.HandleFunc("/about", servePage("about.html"))
	mux.HandleFunc("/docs", servePage("docs.html"))
	mux.HandleFunc("/docs/api", servePage("docs-api.html"))
	mux.HandleFunc("/docs/quickstart", servePage("docs-quickstart.html"))

	// Guides
	mux.HandleFunc("/guides/own-domain-catch-all-inbox", servePage("guides-own-domain.html"))
	mux.HandleFunc("/guides/temp-mail-for-ai-agents", servePage("guides-ai-agents.html"))
	mux.HandleFunc("/guides/nodejs-temp-mail-api", servePage("guides-nodejs.html"))
	mux.HandleFunc("/guides/python-disposable-email-api", servePage("guides-python.html"))

	// Comparisons
	mux.HandleFunc("/vs/10minutemail", servePage("vs-10minutemail.html"))
	mux.HandleFunc("/vs/guerrilla-mail", servePage("vs-guerrilla-mail.html"))
	mux.HandleFunc("/vs/mailtrap", servePage("vs-mailtrap.html"))
	mux.HandleFunc("/vs/testmail-app", servePage("vs-testmail-app.html"))
	mux.HandleFunc("/vs/yopmail", servePage("vs-yopmail.html"))

	// Meta
	mux.HandleFunc("/openapi.json", servePage("openapi.json"))
	mux.HandleFunc("/llms.txt", servePage("llms.txt"))

	server := &http.Server{
		Addr:    ":" + port,
		Handler: corsMiddleware(mux),
	}

	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Server exited: %v", err)
	}
}
