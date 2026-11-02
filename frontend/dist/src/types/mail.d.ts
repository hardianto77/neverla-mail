/**
 * Neverla Mail Type Definitions
 * Compatible with RFC 3339, OpenAPI 3.1 & MCP JSON-RPC 2.0
 */
export interface MailboxMessageSummary {
    id: string;
    from: string;
    from_name?: string;
    subject: string;
    date: string;
    seen: boolean;
    attachments: number;
    expires_at: string;
}
export interface MailboxResponse {
    address: string;
    alias: string;
    count: number;
    next: string | null;
    messages: MailboxMessageSummary[];
}
export interface AttachmentDescriptor {
    id: string;
    filename: string;
    mime: string;
    size: number;
    url: string;
}
export interface FullMessageDetail {
    id: string;
    from: string;
    from_name?: string;
    to: string;
    subject: string;
    date: string;
    seen: boolean;
    text: string;
    text_derived: boolean;
    html: string | null;
    attachments: AttachmentDescriptor[];
}
export interface DomainListResponse {
    public: string[];
    retention_days: number;
    max_attachment: string;
    blocklisted: boolean;
    blocklist_note: string;
    own_domain: string;
    premium: {
        count: number;
        tld: string;
        what: string;
        why: string;
        unlocked: boolean;
    };
}
