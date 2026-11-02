package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/hardianto77/neverla-mail/backend/pkg/storage"
)

var PublicDomains = []string{
	"neverla.web.id", "fldubai.com", "mynes.com", "hunnur.com", "binich.com",
	"vitahicks.com", "zeropolly.com", "rodhazlitt.com", "dripzgaming.com",
	"tshirtsavvy.com", "yopmail.com", "gmail.com", "googlemail.com",
	"grabmail.io", "linqmail.com", "mixozia.com", "devrungkad.biz.id", "zennext.biz.id",
}

type Handler struct {
	db *storage.DB
}

func NewHandler(db *storage.DB) *Handler {
	return &Handler{db: db}
}

func (h *Handler) GetDomains(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	resp := map[string]interface{}{
		"public":         PublicDomains,
		"retention_days": 5,
		"max_attachment": "5 MB",
		"blocklisted":    true,
		"blocklist_note": "public domains are heavily blocklisted by signup forms",
		"own_domain":     "https://mail.neverla.web.id/domains",
		"premium": map[string]interface{}{
			"count":    97,
			"tld":      ".com, .io, .net",
			"what":     "A private pool of 97 domains.",
			"why":      "None of them on the disposable-mail blocklists — that is the whole point.",
			"unlocked": false,
		},
	}
	json.NewEncoder(w).Encode(resp)
}

func (h *Handler) GetMailbox(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	addr := r.URL.Query().Get("address")
	if addr == "" {
		addr = r.URL.Query().Get("mailbox")
	}
	if addr == "" {
		http.Error(w, `{"error":"invalid_address","message":"Missing address query"}`, http.StatusBadRequest)
		return
	}

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if val, err := strconv.Atoi(l); err == nil && val > 0 && val <= 200 {
			limit = val
		}
	}

	var before int64 = 0
	if b := r.URL.Query().Get("before"); b != "" {
		if val, err := strconv.ParseInt(b, 10, 64); err == nil {
			before = val
		}
	}

	msgs, err := h.db.GetMailbox(addr, limit, before)
	if err != nil {
		http.Error(w, `{"error":"server_error","message":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}

	alias := h.db.GetAlias(addr)
	resp := map[string]interface{}{
		"address":  addr,
		"alias":    alias,
		"count":    len(msgs),
		"next":     nil,
		"messages": msgs,
	}
	json.NewEncoder(w).Encode(resp)
}

func (h *Handler) GetMessage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 {
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}
	id := parts[3]

	msg, err := h.db.GetMessageByID(id)
	if err != nil {
		http.Error(w, `{"error":"not_found","message":"Message not found"}`, http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(msg)
}
