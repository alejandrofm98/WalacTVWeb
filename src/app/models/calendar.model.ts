export interface ChannelResolved {
  channel_id: string;
  display_name: string;
  quality: string;
  priority: number;
  source_name: string;
}

export interface CalendarEvent {
  id: string;
  fecha: string;
  hora: string;
  competicion: string | null;
  categoria: string | null;
  equipos: string;
  canales_original: string[];
  canales_resueltos: ChannelResolved[];
}

export interface CalendarDayResponse {
  fecha: string;
  total_eventos: number;
  eventos: CalendarEvent[];
}
