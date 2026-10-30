import type { Message } from '../lib/types'
import { timeAgo } from '../lib/format'
import { Avatar } from './Avatar'
import { t } from '../lib/i18n'

// Read-only, matching this dashboard's design (Dashboard.tsx never inserts
// or updates): sending a message is mobile-only
// (mobile/app/(app)/(tabs)/chat.tsx). A parent watching the web dashboard
// still sees what the family's saying, same reasoning as the SOS banner.
export function ChatFeed({ messages }: { messages: Message[] }) {
  return (
    <div className="chat-feed">
      <h2 className="sidebar-section-title">{t('Chat')}</h2>
      <ul className="chat-list">
        {messages.map((message) => (
          <li key={message.id} className="chat-row">
            <Avatar
              id={message.user_id}
              name={message.profiles?.full_name ?? '?'}
              url={message.profiles?.avatar_url}
              size={24}
            />
            <div className="chat-body">
              <div className="chat-meta">
                <span className="chat-sender">{message.profiles?.full_name ?? 'Someone'}</span>
                <span className="chat-time">{timeAgo(message.created_at)}</span>
              </div>
              <div className="chat-text">{message.body}</div>
              {message.latitude != null && message.longitude != null && (
                <a
                  className="chat-map-link"
                  href={`https://www.google.com/maps/search/?api=1&query=${message.latitude},${message.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on map ›
                </a>
              )}
            </div>
          </li>
        ))}
        {messages.length === 0 && <li className="activity-empty">{t('No messages yet.')}</li>}
      </ul>
    </div>
  )
}
