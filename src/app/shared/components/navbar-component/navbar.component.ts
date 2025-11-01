import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css']
})
export class NavbarComponent {
  private authService = inject(AuthService);

  isLoading = false;
  userEmail: string | null = null;
  isMenuOpen = false; // 👈 Nuevo: controla el menú móvil

  ngOnInit() {
    const user = this.authService.getCurrentUser();
    this.userEmail = user?.email || null;
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
      console.log('🚪 Cerrando sesión...');

      await this.authService.logout();

      console.log('✅ Sesión cerrada');
      window.location.href = '/login';
    } catch (error) {
      console.error('❌ Error al cerrar sesión:', error);
      alert('Error al cerrar sesión');
      this.isLoading = false;
    }
  }
}
