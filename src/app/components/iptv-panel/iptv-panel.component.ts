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
  created_at: string;
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
  users: UserResponse[] = [];

  showAddUser = false;
  newUsername = '';
  newPassword = '';
  newMaxConnections = 1;

  playlistUrl = '';
  showPlaylistModal = false;
  currentUsername = '';

  constructor(
    private api: IptvApiService,
    private authService: AuthService
  ) {
    this.currentUsername = this.authService.getUsername() || '';
  }

  ngOnInit(): void {
    this.loadStats();
    this.loadUsers();
    setInterval(() => { this.loadStats(); this.loadUsers(); }, 10000);
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
    this.api.getUsers().subscribe((u: UserResponse[]) => { this.users = u || []; });
  }

  openAddUser(): void { this.showAddUser = true; }
  closeModal(): void { this.showAddUser = false; this.showPlaylistModal = false; }

  createUser(): void {
    const payload = {
      username: this.newUsername,
      password: this.newPassword,
      max_connections: this.newMaxConnections,
      role: 'user'
    };
    this.api.createUser(payload).subscribe(() => {
      this.closeModal();
      this.newUsername = '';
      this.newPassword = '';
      this.newMaxConnections = 1;
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
