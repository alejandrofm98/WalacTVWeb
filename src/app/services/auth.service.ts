// auth.service.ts
import { Injectable, inject } from '@angular/core';
import { Auth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from '@angular/fire/auth';
import { Database, ref, set, onValue, remove, onDisconnect, get } from '@angular/fire/database';
import { Observable } from 'rxjs';

export interface SessionData {
  deviceId: string;
  loginTime: number;
  lastActivity: number;
  userAgent: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private auth = inject(Auth);
  private db = inject(Database);
  private currentDeviceId: string;
  private activityInterval: any = null;
  private sessionMonitorUnsubscribe: (() => void) | null = null;
  private isLoggingIn = false;
  private isManualLogout = false; // 🆕 Nueva bandera

  constructor() {
    this.currentDeviceId = this.generateUniqueId();
    console.log('🆔 Device ID generado:', this.currentDeviceId);
    this.setupAuthStateListener();
  }

  private generateUniqueId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private setupAuthStateListener(): void {
    onAuthStateChanged(this.auth, (user) => {
      if (user && !this.isLoggingIn) {
        console.log('👤 onAuthStateChanged: Usuario detectado (auto-config)');
        this.updateLastActivity(user.uid);
        this.setupDisconnectHandler(user.uid);
        this.monitorSessionValidity(user.uid);
        this.startActivityPing(user.uid);
      } else if (!user) {
        console.log('👤 onAuthStateChanged: Usuario desconectado');
        this.stopActivityPing();
        this.stopSessionMonitor();
      }
    });
  }

  private startActivityPing(uid: string): void {
    this.stopActivityPing();
    console.log('⏰ Iniciando ping de actividad');
    this.updateLastActivity(uid);

    this.activityInterval = setInterval(() => {
      this.updateLastActivity(uid);
    }, 30000);
  }

  private stopActivityPing(): void {
    if (this.activityInterval) {
      console.log('⏰ Deteniendo ping de actividad');
      clearInterval(this.activityInterval);
      this.activityInterval = null;
    }
  }

  private stopSessionMonitor(): void {
    if (this.sessionMonitorUnsubscribe) {
      console.log('👁️ Deteniendo monitor de sesión');
      this.sessionMonitorUnsubscribe();
      this.sessionMonitorUnsubscribe = null;
    }
  }

  private monitorSessionValidity(uid: string): void {
    this.stopSessionMonitor();

    const sessionRef = ref(this.db, `activeSessions/${uid}/${this.currentDeviceId}`);
    console.log('👁️ Iniciando monitor de sesión para device:', this.currentDeviceId);

    this.sessionMonitorUnsubscribe = onValue(sessionRef, (snapshot) => {
      const data = snapshot.val();

      console.log('📊 Estado de sesión:', {
        exists: snapshot.exists(),
        deviceId: this.currentDeviceId,
        data: data,
        hasCurrentUser: !!this.auth.currentUser,
        isLoggingIn: this.isLoggingIn,
        isManualLogout: this.isManualLogout // 🆕 Log adicional
      });

      // 🆕 Solo mostrar alerta si NO es un cierre manual
      if (!snapshot.exists() && this.auth.currentUser && !this.isLoggingIn && !this.isManualLogout) {
        console.log('⚠️ Sesión eliminada - Cerrando sesión local');

        this.stopActivityPing();
        this.stopSessionMonitor();

        signOut(this.auth).then(() => {
          alert('Tu sesión ha sido cerrada porque iniciaste sesión en otro dispositivo');
          window.location.href = '/login';
        }).catch(err => {
          console.error('Error al cerrar sesión:', err);
        });
      }
    });
  }

  private updateLastActivity(uid: string): void {
    const sessionRef = ref(this.db, `activeSessions/${uid}/${this.currentDeviceId}`);

    const sessionData: Partial<SessionData> = {
      deviceId: this.currentDeviceId,
      lastActivity: Date.now(),
      userAgent: navigator.userAgent
    };

    set(sessionRef, sessionData).catch(err => {
      console.error('Error actualizando actividad:', err);
    });
  }

  private setupDisconnectHandler(uid: string): void {
    const sessionRef = ref(this.db, `activeSessions/${uid}/${this.currentDeviceId}`);
    onDisconnect(sessionRef).remove();
    console.log('🔌 Handler de desconexión configurado');
  }

  /**
   * Verifica sesiones activas usando onValue para garantizar datos en tiempo real
   */
  private checkActiveSession(uid: string): Promise<SessionData | null> {
    return new Promise((resolve, reject) => {
      const sessionsRef = ref(this.db, `activeSessions/${uid}`);

      console.log('🔍 Verificando sesiones activas con listener en tiempo real...');

      try {
        // Usar onValue con { onlyOnce: true } para obtener datos actualizados
        onValue(sessionsRef, (snapshot) => {
          const sessions = snapshot.val();

          console.log('🔍 Sesiones encontradas:', sessions);

          if (!sessions) {
            console.log('ℹ️ No hay sesiones activas');
            resolve(null);
            return;
          }

          // Buscar cualquier sesión activa
          const activeSessions = Object.entries(sessions);

          if (activeSessions.length > 0) {
            const [deviceId, sessionData] = activeSessions[0];
            console.log('⚠️ Sesión activa encontrada:', {
              deviceId,
              loginTime: (sessionData as SessionData).loginTime,
              lastActivity: (sessionData as SessionData).lastActivity
            });

            resolve({
              ...(sessionData as SessionData),
              deviceId: deviceId
            });
          } else {
            resolve(null);
          }
        }, { onlyOnce: true });
      } catch (error) {
        console.error('❌ Error verificando sesiones:', error);
        resolve(null);
      }
    });
  }

  /**
   * Cierra todas las sesiones EXCEPTO la actual
   */
  private async closeOtherSessions(uid: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sessionsRef = ref(this.db, `activeSessions/${uid}`);

      const unsubscribe = onValue(sessionsRef, async (snapshot) => {
        const sessions = snapshot.val();

        console.log('🗑️ Cerrando otras sesiones. Total sesiones:', sessions);

        if (sessions) {
          const promises = Object.keys(sessions)
            .filter(deviceId => deviceId !== this.currentDeviceId)
            .map(deviceId => {
              console.log('❌ Cerrando sesión de device:', deviceId);
              return remove(ref(this.db, `activeSessions/${uid}/${deviceId}`));
            });

          try {
            await Promise.all(promises);
            console.log('✅ Otras sesiones cerradas exitosamente');
            resolve();
          } catch (error) {
            console.error('Error cerrando otras sesiones:', error);
            reject(error);
          }
        } else {
          console.log('ℹ️ No hay otras sesiones para cerrar');
          resolve();
        }
      }, { onlyOnce: true });
    });
  }

  /**
   * Registra una nueva sesión
   */
  private async registerSession(uid: string): Promise<void> {
    const sessionRef = ref(this.db, `activeSessions/${uid}/${this.currentDeviceId}`);
    const sessionData: SessionData = {
      deviceId: this.currentDeviceId,
      loginTime: Date.now(),
      lastActivity: Date.now(),
      userAgent: navigator.userAgent
    };

    console.log('📝 Registrando sesión:', sessionData);
    await set(sessionRef, sessionData);
    this.setupDisconnectHandler(uid);
  }

  /**
   * Login con verificación de sesión única
   */
  async login(email: string, password: string, forceLogin: boolean = false): Promise<any> {
    try {
      console.log('🔐 Iniciando login. ForceLogin:', forceLogin);

      this.isLoggingIn = true;
      this.isManualLogout = false; // 🆕 Resetear bandera al hacer login

      // Autenticar al usuario
      const userCredential = await signInWithEmailAndPassword(this.auth, email, password);
      const uid = userCredential.user.uid;

      console.log('✅ Autenticación exitosa. UID:', uid);

      // Esperar un momento para que Firebase sincronice
      await new Promise(resolve => setTimeout(resolve, 500));

      if (!forceLogin) {
        // Verificar si hay sesiones activas
        const activeSession = await this.checkActiveSession(uid);

        if (activeSession) {
          console.log('⚠️ Sesión activa detectada:', activeSession);

          // Cerrar la sesión de Firebase
          await signOut(this.auth);
          this.isLoggingIn = false;

          return {
            success: false,
            requiresConfirmation: true,
            activeSession: activeSession,
            message: 'Ya existe una sesión activa en otro dispositivo'
          };
        }

        // No hay sesiones activas, registrar esta
        console.log('✅ No hay conflictos, registrando nueva sesión');
        await this.registerSession(uid);

        // Configurar monitoring y pings
        this.setupDisconnectHandler(uid);
        this.monitorSessionValidity(uid);
        this.startActivityPing(uid);

        this.isLoggingIn = false;

        return {
          success: true,
          user: userCredential.user
        };
      } else {
        // ForceLogin: registrar nueva sesión y cerrar las demás
        console.log('🔄 Login forzado iniciado');

        await this.registerSession(uid);
        console.log('📝 Nueva sesión registrada');

        await this.closeOtherSessions(uid);
        console.log('🗑️ Otras sesiones cerradas');

        // Configurar monitoring y pings
        this.setupDisconnectHandler(uid);
        this.monitorSessionValidity(uid);
        this.startActivityPing(uid);

        this.isLoggingIn = false;

        console.log('✅ Login forzado completado');

        return {
          success: true,
          user: userCredential.user
        };
      }
    } catch (error: any) {
      console.error('❌ Error en login:', error);
      this.isLoggingIn = false;
      throw error;
    }
  }

  /**
   * Cierra la sesión actual
   */
  async logout(): Promise<void> {
    console.log('🚪 Cerrando sesión manualmente');

    // 🆕 Activar bandera ANTES de eliminar la sesión
    this.isManualLogout = true;

    // Detener monitores primero
    this.stopActivityPing();
    this.stopSessionMonitor();

    const user = this.auth.currentUser;
    if (user) {
      const sessionRef = ref(this.db, `activeSessions/${user.uid}/${this.currentDeviceId}`);
      await remove(sessionRef);
    }

    await signOut(this.auth);

    // 🆕 Resetear bandera después del logout
    this.isManualLogout = false;
  }

  getCurrentUser() {
    return this.auth.currentUser;
  }

  getAuthState(): Observable<any> {
    return new Observable((observer) => {
      onAuthStateChanged(this.auth, (user) => {
        observer.next(user);
      });
    });
  }
}
