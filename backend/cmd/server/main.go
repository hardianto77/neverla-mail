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
	"regexp"
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

func extractOTP(text string) string {
	re := regexp.MustCompile(`\b\d{4,8}\b`)
	return re.FindString(text)
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

// ── REST API HANDLERS ──────────────────────────────────────────

func handleDomains(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"domains": domains,
		"count":   len(domains),
	})
}

type MessageItem struct {
	ID        string      `json:"id"`
	From      interface{} `json:"from"`
	Subject   string      `json:"subject"`
	Date      string      `json:"date"`
	Seen      bool        `json:"seen"`
	Intro     string      `json:"intro"`
	CreatedAt int64       `json:"created_at"`
	OTPCode   string      `json:"otp_code,omitempty"`
}

func handleMailbox(w http.ResponseWriter, r *http.Request) {
	address := r.URL.Query().Get("address")
	if address == "" {
		address = r.URL.Query().Get("mailbox")
	}
	if address == "" {
		http.Error(w, `{"error":"Missing address query parameter"}`, http.StatusBadRequest)
		return
	}

	alias := computeAlias(address)
	dbMutex.RLock()
	query := "SELECT id, from_email, from_name, subject, date, seen, text, created_at FROM messages WHERE address = ? OR alias = ? ORDER BY created_at DESC"
	rows, err := db.Query(query, address, alias)
	dbMutex.RUnlock()

	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var list []MessageItem
	for rows.Next() {
		var (
			id, fromEmail, fromName, subject, date, text sql.NullString
			seen                                         int
			createdAt                                    int64
		)
		if err := rows.Scan(&id, &fromEmail, &fromName, &subject, &date, &seen, &text, &createdAt); err == nil {
			otp := extractOTP(subject.String + " " + text.String)
			intro := text.String
			if len(intro) > 100 {
				intro = intro[:100]
			}
			fromObj := map[string]string{
				"address": fromEmail.String,
				"name":    fromName.String,
			}
			list = append(list, MessageItem{
				ID:        id.String,
				From:      fromObj,
				Subject:   subject.String,
				Date:      date.String,
				Seen:      seen == 1,
				Intro:     intro,
				CreatedAt: createdAt,
				OTPCode:   otp,
			})
		}
	}
	if list == nil {
		list = []MessageItem{}
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

	if r.Method == "DELETE" {
		dbMutex.Lock()
		_, err := db.Exec("DELETE FROM messages WHERE id = ?", id)
		dbMutex.Unlock()
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "deleted_id": id})
		return
	}

	dbMutex.RLock()
	var (
		address, alias, fromEmail, fromName, toEmail, subject, date, text, html, attachmentsJSON, expiresAt sql.NullString
		seen                                                                                                int
		createdAt                                                                                           int64
	)
	query := "SELECT address, alias, from_email, from_name, to_email, subject, date, seen, text, html, attachments_json, expires_at, created_at FROM messages WHERE id = ?"
	err := db.QueryRow(query, id).Scan(
		&address, &alias, &fromEmail, &fromName, &toEmail, &subject, &date, &seen, &text, &html, &attachmentsJSON, &expiresAt, &createdAt,
	)
	dbMutex.RUnlock()

	if err != nil {
		http.Error(w, `{"error":"Message not found"}`, http.StatusNotFound)
		return
	}

	var attachList []interface{}
	if attachmentsJSON.Valid && attachmentsJSON.String != "" {
		json.Unmarshal([]byte(attachmentsJSON.String), &attachList)
	}
	if attachList == nil {
		attachList = []interface{}{}
	}

	otp := extractOTP(subject.String + " " + text.String)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":      id,
		"address": address.String,
		"alias":   alias.String,
		"from": map[string]string{
			"address": fromEmail.String,
			"name":    fromName.String,
		},
		"to":          toEmail.String,
		"subject":     subject.String,
		"date":        date.String,
		"seen":        seen == 1,
		"text":        text.String,
		"html":        html.String,
		"attachments": attachList,
		"expires_at":  expiresAt.String,
		"created_at":  createdAt,
		"otp_code":    otp,
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
		FromName string `json:"from_name"`
		Subject  string `json:"subject"`
		BodyText string `json:"body_text"`
		BodyHTML string `json:"body_html"`
		OTPCode  string `json:"otp_code"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, `{"error":"Invalid payload"}`, http.StatusBadRequest)
		return
	}

	if req.OTPCode == "" {
		req.OTPCode = extractOTP(req.Subject + " " + req.BodyText)
	}

	id := fmt.Sprintf("msg_%d", time.Now().UnixNano())
	alias := computeAlias(req.Address)
	now := time.Now()
	dateStr := now.UTC().Format(time.RFC3339)
	expiresAt := now.Add(5 * 24 * time.Hour).UTC().Format(time.RFC3339)
	createdMs := now.UnixMilli()

	if req.FromName == "" {
		req.FromName = "Verification Service"
	}

	dbMutex.Lock()
	query := `INSERT INTO messages (
		id, address, alias, from_email, from_name, to_email, subject, date, seen, text, html, attachments_json, expires_at, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, '[]', ?, ?)`
	_, err := db.Exec(query, id, req.Address, alias, req.From, req.FromName, req.Address, req.Subject, dateStr, req.BodyText, req.BodyHTML, expiresAt, createdMs)
	dbMutex.Unlock()

	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"id":       id,
		"address":  req.Address,
		"alias":    alias,
		"otp_code": req.OTPCode,
	})
}

// ── MCP JSON-RPC 2.0 PROTOCOL HANDLER ────────────────────────

type MCPRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      interface{}     `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type MCPResponse struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      interface{} `json:"id"`
	Result  interface{} `json:"result,omitempty"`
	Error   interface{} `json:"error,omitempty"`
}

func handleMCP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != "POST" {
		json.NewEncoder(w).Encode(MCPResponse{
			JSONRPC: "2.0",
			Error:   map[string]interface{}{"code": -32600, "message": "Invalid Request: MCP requires POST"},
		})
		return
	}

	body, _ := io.ReadAll(r.Body)
	var req MCPRequest
	if err := json.Unmarshal(body, &req); err != nil {
		json.NewEncoder(w).Encode(MCPResponse{
			JSONRPC: "2.0",
			Error:   map[string]interface{}{"code": -32700, "message": "Parse error"},
		})
		return
	}

	switch req.Method {
	case "initialize":
		json.NewEncoder(w).Encode(MCPResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]interface{}{
				"protocolVersion": "2024-11-05",
				"capabilities":    map[string]interface{}{"tools": map[string]interface{}{}},
				"serverInfo":      map[string]interface{}{"name": "neverla-mail-mcp", "version": "1.0.0"},
			},
		})

	case "tools/list":
		json.NewEncoder(w).Encode(MCPResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]interface{}{
				"tools": []map[string]interface{}{
					{
						"name":        "list_domains",
						"description": "Get all active disposable mail domains available for inbox generation.",
						"inputSchema": map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
					},
					{
						"name":        "get_mailbox",
						"description": "Retrieve received messages for a specific mailbox address.",
						"inputSchema": map[string]interface{}{
							"type":       "object",
							"properties": map[string]interface{}{"address": map[string]interface{}{"type": "string", "description": "Full email address (e.g. test@fldubai.com)"}},
							"required":   []string{"address"},
						},
					},
					{
						"name":        "read_message",
						"description": "Read full message content, body text/HTML, and extracted OTP code by ID.",
						"inputSchema": map[string]interface{}{
							"type":       "object",
							"properties": map[string]interface{}{"id": map[string]interface{}{"type": "string", "description": "Message ID"}},
							"required":   []string{"id"},
						},
					},
					{
						"name":        "extract_code",
						"description": "Directly get latest 4-8 digit OTP verification code for an email address.",
						"inputSchema": map[string]interface{}{
							"type":       "object",
							"properties": map[string]interface{}{"address": map[string]interface{}{"type": "string", "description": "Email address"}},
							"required":   []string{"address"},
						},
					},
				},
			},
		})

	case "tools/call":
		var callParams struct {
			Name      string                 `json:"name"`
			Arguments map[string]interface{} `json:"arguments"`
		}
		json.Unmarshal(req.Params, &callParams)

		switch callParams.Name {
		case "list_domains":
			json.NewEncoder(w).Encode(MCPResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Result: map[string]interface{}{
					"content": []map[string]interface{}{{"type": "text", "text": fmt.Sprintf("%v", domains)}},
					"domains": domains,
				},
			})

		case "get_mailbox":
			addr, _ := callParams.Arguments["address"].(string)
			alias := computeAlias(addr)
			dbMutex.RLock()
			rows, _ := db.Query("SELECT id, from_email, from_name, subject, date, seen, text, created_at FROM messages WHERE address = ? OR alias = ? ORDER BY created_at DESC", addr, alias)
			dbMutex.RUnlock()
			var msgs []MessageItem
			if rows != nil {
				for rows.Next() {
					var id, fromEmail, fromName, subject, date, text sql.NullString
					var seen int
					var createdAt int64
					rows.Scan(&id, &fromEmail, &fromName, &subject, &date, &seen, &text, &createdAt)
					otp := extractOTP(subject.String + " " + text.String)
					msgs = append(msgs, MessageItem{
						ID:        id.String,
						From:      map[string]string{"address": fromEmail.String, "name": fromName.String},
						Subject:   subject.String,
						Date:      date.String,
						Seen:      seen == 1,
						CreatedAt: createdAt,
						OTPCode:   otp,
					})
				}
				rows.Close()
			}
			json.NewEncoder(w).Encode(MCPResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Result: map[string]interface{}{
					"address":  addr,
					"messages": msgs,
					"content":  []map[string]interface{}{{"type": "text", "text": fmt.Sprintf("Found %d messages for %s", len(msgs), addr)}},
				},
			})

		case "read_message":
			msgID, _ := callParams.Arguments["id"].(string)
			dbMutex.RLock()
			var subj, from, body string
			err := db.QueryRow("SELECT subject, from_email, COALESCE(text, '') FROM messages WHERE id = ?", msgID).Scan(&subj, &from, &body)
			dbMutex.RUnlock()
			if err != nil {
				json.NewEncoder(w).Encode(MCPResponse{
					JSONRPC: "2.0",
					ID:      req.ID,
					Error:   map[string]interface{}{"code": -32000, "message": "Message not found"},
				})
				return
			}
			otp := extractOTP(subj + " " + body)
			json.NewEncoder(w).Encode(MCPResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Result: map[string]interface{}{
					"id":       msgID,
					"subject":  subj,
					"from":     from,
					"otp_code": otp,
					"content":  []map[string]interface{}{{"type": "text", "text": body}},
				},
			})

		case "extract_code":
			addr, _ := callParams.Arguments["address"].(string)
			alias := computeAlias(addr)
			dbMutex.RLock()
			rows, _ := db.Query("SELECT subject, text FROM messages WHERE (address = ? OR alias = ?) ORDER BY created_at DESC", addr, alias)
			dbMutex.RUnlock()
			var foundOTP string
			if rows != nil {
				for rows.Next() {
					var subj, body sql.NullString
					rows.Scan(&subj, &body)
					otp := extractOTP(subj.String + " " + body.String)
					if otp != "" {
						foundOTP = otp
						break
					}
				}
				rows.Close()
			}

			if foundOTP == "" {
				json.NewEncoder(w).Encode(MCPResponse{
					JSONRPC: "2.0",
					ID:      req.ID,
					Result: map[string]interface{}{
						"code":    nil,
						"content": []map[string]interface{}{{"type": "text", "text": "No OTP code found for this mailbox"}},
					},
				})
				return
			}
			json.NewEncoder(w).Encode(MCPResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Result: map[string]interface{}{
					"code":    foundOTP,
					"content": []map[string]interface{}{{"type": "text", "text": fmt.Sprintf("Latest OTP code: %s", foundOTP)}},
				},
			})

		default:
			json.NewEncoder(w).Encode(MCPResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Error:   map[string]interface{}{"code": -32601, "message": "Method not found"},
			})
		}

	default:
		json.NewEncoder(w).Encode(MCPResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error:   map[string]interface{}{"code": -32601, "message": "Method not found"},
		})
	}
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
	log.Printf("Neverla Mail High-Performance Go Core (REST + MCP) running on :%s...", port)

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

	// MCP JSON-RPC 2.0 Server
	mux.HandleFunc("/mcp", handleMCP)

	// Static Pages (GrabMail 1:1 Mirror)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.ServeFile(w, r, filepath.Join(pubDir, "index.html"))
			return
		}
		filePath := filepath.Join(pubDir, r.URL.Path)
		if fi, err := os.Stat(filePath); err == nil && !fi.IsDir() {
			http.ServeFile(w, r, filePath)
			return
		}
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
