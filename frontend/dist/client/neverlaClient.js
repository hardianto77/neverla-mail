export class NeverlaMailClient {
    baseUrl;
    constructor(baseUrl = 'https://mail.neverla.web.id/v1') {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
    }
    /**
     * Fetch active domain list
     */
    async getDomains() {
        const res = await fetch(`${this.baseUrl}/domains`);
        if (!res.ok)
            throw new Error(`Failed to fetch domains: ${res.statusText}`);
        return res.json();
    }
    /**
     * Poll inbox for incoming messages
     */
    async getMailbox(address, limit = 50) {
        const res = await fetch(`${this.baseUrl}/mailbox?address=${encodeURIComponent(address)}&limit=${limit}`);
        if (!res.ok)
            throw new Error(`Failed to fetch mailbox: ${res.statusText}`);
        return res.json();
    }
    /**
     * Get single email message detail
     */
    async getMessage(id, mailbox) {
        const res = await fetch(`${this.baseUrl}/message/${encodeURIComponent(id)}?mailbox=${encodeURIComponent(mailbox)}`);
        if (!res.ok)
            throw new Error(`Failed to fetch message: ${res.statusText}`);
        return res.json();
    }
    /**
     * Delete message permanently
     */
    async deleteMessage(id, mailbox) {
        const res = await fetch(`${this.baseUrl}/message/${encodeURIComponent(id)}?mailbox=${encodeURIComponent(mailbox)}`, {
            method: 'DELETE',
        });
        return res.ok;
    }
}
