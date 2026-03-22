import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-logout-button',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './logout-button.component.html',
  styleUrls: ['./logout-button.component.css']
})
export class LogoutButtonComponent {
  private authService = inject(AuthService);
  private router = inject(Router);

  isLoading = false;

  async onLogout() {
    if (this.isLoading) return;

    const confirmed = confirm('¿Estás seguro de que deseas cerrar sesión?');

    if (!confirmed) return;

    try {
      this.isLoading = true;

      await this.authService.logout();

      // Redirigir al login
      this.router.navigate(['/login']);
    } catch (error) {
      console.error('❌ Error al cerrar sesión:', error);
      alert('Error al cerrar sesión. Por favor, inténtalo de nuevo.');
      this.isLoading = false;
    }
  }
}
