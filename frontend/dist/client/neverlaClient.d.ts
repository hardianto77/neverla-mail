import { DomainListResponse, MailboxResponse, FullMessageDetail } from '../types/mail';
export declare class NeverlaMailClient {
    private baseUrl;
    constructor(baseUrl?: string);
    /**
     * Fetch active domain list
     */
    getDomains(): Promise<DomainListResponse>;
    /**
     * Poll inbox for incoming messages
     */
    getMailbox(address: string, limit?: number): Promise<MailboxResponse>;
    /**
     * Get single email message detail
     */
    getMessage(id: string, mailbox: string): Promise<FullMessageDetail>;
    /**
     * Delete message permanently
     */
    deleteMessage(id: string, mailbox: string): Promise<boolean>;
}
