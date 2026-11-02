package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/hardianto77/neverla-mail/backend/pkg/api"
	"github.com/hardianto77/neverla-mail/backend/pkg/storage"
)

func main() {
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "/data/home/neverla-mail/data/mail.db"
	}

	db, err := storage.NewDB(dbPath)
	if err != nil {
		log.Fatalf("Failed to initialize SQLite: %v", err)
	}

	handler := api.NewHandler(db)

	mux := http.NewServeMux()
	mux.HandleFunc("/v1/domains", handler.GetDomains)
	mux.HandleFunc("/api/v1/domains", handler.GetDomains)
	mux.HandleFunc("/v1/mailbox", handler.GetMailbox)
	mux.HandleFunc("/api/v1/mailbox", handler.GetMailbox)
	mux.HandleFunc("/v1/message/", handler.GetMessage)
	mux.HandleFunc("/api/v1/message/", handler.GetMessage)

	port := os.Getenv("GO_PORT")
	if port == "" {
		port = "3418"
	}

	fmt.Printf("[Neverla Go Core] High-performance backend ready on :%s (SQLite: %s)\n", port, dbPath)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}
