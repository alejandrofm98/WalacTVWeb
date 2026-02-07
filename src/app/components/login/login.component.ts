import {Component, OnInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Router} from '@angular/router';
import {AuthService} from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit {
  email: string = '';
  password: string = '';
  loading: boolean = false;
  errorMessage: string = '';

  showSessionModal: boolean = false;
  pendingCredentials: { username: string, password: string } | null = null;

  constructor(
    private authService: AuthService,
    private router: Router
  ) {
  }

  ngOnInit(): void {
    document.body.classList.add('login-page');

    if (this.authService.isAuthenticated()) {
      this.router.navigate(['/']);
    }
  }

  ngOnDestroy(): void {
    document.body.classList.remove('login-page');
  }

  async onLogin() {
    if (!this.email || !this.password) {
      this.errorMessage = 'Por favor, completa todos los campos';
      return;
    }

    this.loading = true;
    this.errorMessage = '';

    try {
      const result = await this.authService.login(this.email, this.password);

      if (result.success) {
        console.log('✅ Login exitoso');
        await this.router.navigate(['/']);
        console.log('✅ Navegación completada');
      } else {
        this.errorMessage = result.message || 'Error al iniciar sesión';
      }
    } catch (error: any) {
      console.error('❌ Error en login:', error);
      this.errorMessage = this.getErrorMessage(error);
    } finally {
      this.loading = false;
    }
  }

  cancelForceLogin() {
    this.showSessionModal = false;
    this.pendingCredentials = null;
  }

  getErrorMessage(error: any): string {
    if (error?.status === 401) {
      return 'Usuario o contraseña incorrectos';
    }
    if (error?.status === 429) {
      return 'Límite de dispositivos alcanzado';
    }
    if (error?.status === 403) {
      return 'Cuenta desactivada o sin permisos';
    }
    return 'Error al iniciar sesión. Intenta de nuevo';
  }
}
