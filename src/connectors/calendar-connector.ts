import { google } from 'googleapis';
import type { MemoryDocument } from '../core/memory.js';

export interface CalendarConfig {
  apiKey?: string;
  calendarId?: string; // Defaults to 'primary'
}

export class CalendarConnector {
  private apiKey: string;
  private calendarId: string;

  constructor(config: CalendarConfig) {
    this.apiKey = config.apiKey || process.env.GOOGLE_CALENDAR_API_KEY || '';
    this.calendarId = config.calendarId || 'primary';
  }

  async fetchEvents(since?: Date, limit = 100): Promise<MemoryDocument[]> {
    if (!this.apiKey) {
      console.warn('No Google Calendar API key configured. Skipping calendar sync.');
      return [];
    }

    const calendar = google.calendar({ version: 'v3', auth: this.apiKey });

    const timeMin = since || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    try {
      const response = await calendar.events.list({
        calendarId: this.calendarId,
        timeMin: timeMin.toISOString(),
        maxResults: limit,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = response.data.items || [];
      const docs: MemoryDocument[] = [];

      for (const event of events) {
        const start = event.start?.dateTime || event.start?.date || 'unknown';
        const end = event.end?.dateTime || event.end?.date || 'unknown';
        const title = event.summary || '(no title)';
        const description = event.description || '';
        const attendees = (event.attendees || [])
          .map((a) => a.email)
          .filter(Boolean)
          .join(', ');
        const organizer = event.organizer?.email || 'unknown';

        docs.push({
          id: `calendar:${event.id}`,
          text: `Meeting: ${title}\nDate: ${start} to ${end}\nOrganizer: ${organizer}\nAttendees: ${attendees}\n\n${description}`,
          metadata: {
            source: 'calendar',
            type: 'event',
            title,
            date: start,
            organizer,
            attendees,
            url: event.htmlLink || '',
          },
        });
      }

      console.log(`Fetched ${docs.length} calendar events.`);
      return docs;
    } catch (error) {
      console.error('Calendar fetch error:', error instanceof Error ? error.message : error);
      return [];
    }
  }
}
