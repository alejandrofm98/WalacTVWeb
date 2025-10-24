// login.component.ts
import {Component} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Router} from '@angular/router';
import {AuthService, SessionData} from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {
  email: string = '';
  password: string = '';
  loading: boolean = false;
  errorMessage: string = '';

  // Para el modal de confirmación
  showSessionModal: boolean = false;
  activeSessionInfo: SessionData | null = null;
  pendingCredentials: { email: string, password: string } | null = null;

  constructor(
    private authService: AuthService,
    private router: Router
  ) {
  }

  ngOnInit(): void {
    // 🔥 Agregar clase al body para excluir el padding
    document.body.classList.add('login-page');
  }

  ngOnDestroy(): void {
    // 🔥 Remover clase al salir del componente
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
        // Login exitoso - redirigir a events-list
        console.log('✅ Login exitoso', result.user);
        await this.router.navigate(['/']); // Usa await para asegurar la navegación
        console.log('✅ Navegación completada');
      } else if (result.requiresConfirmation) {
        // Hay una sesión activa, mostrar modal
        this.showSessionModal = true;
        this.activeSessionInfo = result.activeSession;
        this.pendingCredentials = {
          email: this.email,
          password: this.password
        };
      }
    } catch (error: any) {
      console.error('❌ Error en login:', error);
      this.errorMessage = this.getErrorMessage(error.code);
    } finally {
      this.loading = false;
    }
  }

  async confirmForceLogin() {
    if (!this.pendingCredentials) return;

    this.loading = true;
    this.showSessionModal = false;

    try {
      const result = await this.authService.login(
        this.pendingCredentials.email,
        this.pendingCredentials.password,
        true // forceLogin = true
      );

      if (result.success) {
        console.log('✅ Login forzado exitoso', result.user);
        await this.router.navigate(['/']); // Usa await para asegurar la navegación
        console.log('✅ Navegación completada');
      }
    } catch (error: any) {
      console.error('❌ Error en login forzado:', error);
      this.errorMessage = this.getErrorMessage(error.code);
    } finally {
      this.loading = false;
      this.pendingCredentials = null;
    }
  }

  cancelForceLogin() {
    this.showSessionModal = false;
    this.pendingCredentials = null;
    this.activeSessionInfo = null;
  }

  getErrorMessage(errorCode: string): string {
    const errors: { [key: string]: string } = {
      'auth/invalid-email': 'El correo electrónico no es válido',
      'auth/user-disabled': 'Esta cuenta ha sido deshabilitada',
      'auth/user-not-found': 'No existe una cuenta con este correo',
      'auth/wrong-password': 'Contraseña incorrecta',
      'auth/too-many-requests': 'Demasiados intentos. Intenta más tarde',
      'auth/network-request-failed': 'Error de conexión. Verifica tu internet'
    };

    return errors[errorCode] || 'Error al iniciar sesión. Intenta de nuevo';
  }

  formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString('es-ES');
  }

  getDeviceInfo(userAgent: string): string {
    if (userAgent.includes('Mobile')) return 'Dispositivo móvil';
    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari')) return 'Safari';
    return 'Navegador desconocido';
  }
}
