import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { CacheService } from '../../../services/cache.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css']
})
export class NavbarComponent implements OnInit {
  private authService = inject(AuthService);
  private cacheService = inject(CacheService);

  isLoading = false;
  username: string | null = null;
  isMenuOpen = false;
  isAdminUser = false;

  ngOnInit() {
    this.authService.currentUser$.subscribe(user => {
      if (user) {
        this.username = user.username;
        this.isAdminUser = user.role === 'admin';
      } else {
        this.username = null;
        this.isAdminUser = false;
      }
    });
  }

  toggleMenu() {
    this.isMenuOpen = !this.isMenuOpen;
  }

  closeMenu() {
    this.isMenuOpen = false;
  }

  async onLogout() {
    if (this.isLoading) return;

    const confirmed = confirm('¿Estás seguro de que deseas cerrar sesión?');
    if (!confirmed) return;

    try {
      this.isLoading = true;

      // Limpiar caché al cerrar sesión
      this.cacheService.clear();

      await this.authService.logout();

      window.location.href = '/login';
    } catch (error) {
      console.error('❌ Error al cerrar sesión:', error);
      alert('Error al cerrar sesión');
      this.isLoading = false;
    }
  }
}
