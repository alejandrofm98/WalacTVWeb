import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavbarComponent } from '../../shared/components/navbar-component/navbar.component';
import { IptvApiService } from './iptv-api.service';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

interface UserResponse {
  id: string;
  username: string;
  email?: string;
  role: string;
  max_connections: number;
  is_active: boolean;
  expires_at?: string;
  created_at: string;
}

interface SessionData {
  id: string;
  user_id: string;
  username?: string;
  device_id: string;
  device_name: string;
  device_type: string;
  ip_address: string;
  user_agent: string;
  last_activity: string;
  created_at?: string;
}

interface UserWithSessions extends UserResponse {
  sessions: SessionData[];
  sessionsCount: number;
  expanded?: boolean;
}

@Component({
  selector: 'app-iptv-panel',
  standalone: true,
  imports: [CommonModule, NavbarComponent, FormsModule],
  templateUrl: './iptv-panel.component.html',
  styleUrls: ['./iptv-panel.component.css']
})
export class IptvPanelComponent implements OnInit {
  totalUsers = 0;
  activeUsers = 0;
  totalSessions = 0;
  totalChannels = 0;
  totalMovies = 0;
  totalSeries = 0;
  users: UserWithSessions[] = [];
  allSessions: SessionData[] = [];

  showAddUser = false;
  newUsername = '';
  newPassword = '';
  newMaxConnections = 1;
  newExpiresAt = '';

  playlistUrl = '';
  showPlaylistModal = false;
  currentUsername = '';

  expandedUsers: Set<string> = new Set();

  constructor(
    private api: IptvApiService,
    private authService: AuthService
  ) {
    this.currentUsername = this.authService.getUsername() || '';
  }

  ngOnInit(): void {
    this.loadStats();
    this.loadUsers();
    this.loadSessions();
    setInterval(() => {
      this.loadStats();
      this.loadUsers();
      this.loadSessions();
    }, 10000);
  }

  loadStats(): void {
    this.api.getStats().subscribe((s: any) => {
      this.totalUsers = s.total_users || 0;
      this.activeUsers = s.active_users || 0;
      this.totalSessions = s.total_sessions || 0;
      this.totalChannels = s.total_channels || 0;
      this.totalMovies = s.total_movies || 0;
      this.totalSeries = s.total_series || 0;
    });
  }

  loadUsers(): void {
    this.api.getUsers().subscribe((u: UserResponse[]) => {
      const sessionsMap = this.groupSessionsByUser(this.allSessions);
      this.users = (u || []).map(user => ({
        ...user,
        sessions: sessionsMap[user.id] || [],
        sessionsCount: sessionsMap[user.id]?.length || 0,
        expanded: this.expandedUsers.has(user.id)
      }));
    });
  }

  loadSessions(): void {
    this.api.getSessions().subscribe((sessions: SessionData[]) => {
      this.allSessions = sessions || [];
      const sessionsMap = this.groupSessionsByUser(this.allSessions);
      this.users = this.users.map(user => ({
        ...user,
        sessions: sessionsMap[user.id] || [],
        sessionsCount: sessionsMap[user.id]?.length || 0
      }));
    });
  }

  private groupSessionsByUser(sessions: SessionData[]): Record<string, SessionData[]> {
    const map: Record<string, SessionData[]> = {};
    for (const session of sessions) {
      const userId = session.user_id;
      if (!map[userId]) {
        map[userId] = [];
      }
      map[userId].push(session);
    }
    return map;
  }

  toggleUserSessions(userId: string): void {
    if (this.expandedUsers.has(userId)) {
      this.expandedUsers.delete(userId);
    } else {
      this.expandedUsers.add(userId);
    }
    this.users = this.users.map(u => ({
      ...u,
      expanded: this.expandedUsers.has(u.id)
    }));
  }

  disconnectDevice(userId: string, deviceId: string): void {
    if (!confirm('¿Desconectar este dispositivo?')) return;
    this.api.disconnectDevice(userId, deviceId).subscribe(() => {
      this.loadSessions();
    });
  }

  disconnectAllUserDevices(userId: string): void {
    if (!confirm('¿Desconectar todos los dispositivos de este usuario?')) return;
    this.api.disconnectAllDevices(userId).subscribe(() => {
      this.loadSessions();
    });
  }

  openAddUser(): void { this.showAddUser = true; }
  closeModal(): void { this.showAddUser = false; this.showPlaylistModal = false; }

  createUser(): void {
    const payload: any = {
      username: this.newUsername,
      password: this.newPassword,
      max_connections: this.newMaxConnections,
      role: 'user'
    };
    if (this.newExpiresAt) {
      payload.expires_at = new Date(this.newExpiresAt + 'T23:59:59').toISOString();
    }
    this.api.createUser(payload).subscribe(() => {
      this.closeModal();
      this.newUsername = '';
      this.newPassword = '';
      this.newMaxConnections = 1;
      this.newExpiresAt = '';
      this.loadUsers();
      this.loadStats();
    });
  }

  deleteUser(id: string): void {
    if (!confirm('¿Eliminar este usuario?')) return;
    this.api.deleteUser(id).subscribe(() => { this.loadUsers(); this.loadStats(); });
  }

  showPlaylist(username: string): void {
    const password = prompt('Ingresa la contraseña del usuario:');
    if (!password) return;

    const token = prompt('Token de admin (opcional):');
    this.playlistUrl = `playlist/${username}/${password}.m3u`;
    this.showPlaylistModal = true;
  }

  copyPlaylistUrl(): void {
    navigator.clipboard.writeText(this.playlistUrl);
    alert('URL copiada al portapapeles');
  }

  formatDate(dateString: string): string {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('es-ES');
  }

  formatTime(dateString: string): string {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  formatLastActivity(dateString: string): string {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Ahora';
    if (diffMins < 60) return `Hace ${diffMins}m`;
    if (diffHours < 24) return `Hace ${diffHours}h`;
    if (diffDays < 7) return `Hace ${diffDays}d`;
    
    return date.toLocaleDateString('es-ES');
  }

  formatExpires(dateString?: string): string {
    if (!dateString) return 'Nunca';
    const date = new Date(dateString);
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    
    if (days < 0) return 'Expirado';
    if (days === 0) return 'Hoy';
    if (days === 1) return 'Mañana';
    if (days <= 7) return `${days} días`;
    
    return date.toLocaleDateString('es-ES');
  }

  isExpired(user: UserResponse): boolean {
    if (!user.expires_at) return false;
    return new Date(user.expires_at) < new Date();
  }

  isExpiringSoon(user: UserResponse): boolean {
    if (!user.expires_at) return false;
    const date = new Date(user.expires_at);
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const days = diff / (1000 * 60 * 60 * 24);
    return days > 0 && days <= 7;
  }

  getDeviceTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      'tv': '📺',
      'mobile': '📱',
      'desktop': '💻',
      'unknown': '🔌'
    };
    return icons[type] || icons['unknown'];
  }

  reloadTemplate(): void {
    this.api.reloadTemplate().subscribe(response => {
      if (response) {
        alert('Template recargado exitosamente');
      } else {
        alert('Error al recargar template');
      }
    });
  }
}
