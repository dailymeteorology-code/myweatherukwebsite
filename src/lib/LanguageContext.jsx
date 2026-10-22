import React, { createContext, useContext, useState, useEffect } from 'react';

export const LANGUAGES = [
  { code: 'en', label: 'English',  flag: '🇬🇧' },
  { code: 'es', label: 'Español',  flag: '🇪🇸' },
  { code: 'pl', label: 'Polski',   flag: '🇵🇱' },
  { code: 'zh', label: '中文',      flag: '🇨🇳' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'de', label: 'Deutsch',  flag: '🇩🇪' },
];

// UI strings — add more keys as needed
export const TRANSLATIONS = {
  en: {
    // Nav / Layout
    home: 'Home', locationWeather: 'Location Weather', news: 'News', graphics: 'Graphics', newsletter: 'Newsletter',
    settings: 'Settings', admin: 'Admin',
    login: 'Login', logout: 'Logout',
    // Section Navigation
    activeWarnings: 'Active Warnings', upcomingWarnings: 'Upcoming Warnings',
    myWeatherGraphics: 'MyWeatherUK Graphics', tcmLightning: 'TCM Lightning',
    tcmOutlooks: 'TCM Outlooks', liveRadar: 'Radar',
    signIn: 'Sign In', signUp: 'Sign Up', signOut: 'Sign Out',
    lightMode: 'Light Mode', darkMode: 'Dark Mode',
    // Settings page
    settingsTitle: 'Settings', manageAccount: 'Manage your account',
    yourAccount: 'Your Account', name: 'Name', email: 'Email', role: 'Role',
    units: 'Units of Measurement', unitsDesc: 'Choose your preferred units — changes apply everywhere instantly',
    temperature: 'Temperature', windSpeed: 'Wind Speed', rainfall: 'Rainfall / Snow', hail: 'Hail Diameter',
    freeNewsletter: 'Free Newsletter', newsletterDesc: 'Weekly storm outlooks, model summaries & alerts — free forever',
    manageNewsletter: 'Manage newsletter subscription',
    dangerZone: 'Danger Zone', dangerDesc: 'Irreversible actions — proceed with caution',
    deleteAccount: 'Delete My Account', deleteAccountDesc: 'Permanently delete your account and all associated data. This cannot be undone.',
    deleting: 'Deleting…',
    language: 'Language', languageDesc: 'Choose your preferred display language',
    // Delete dialog
    deleteTitle: 'Delete your account?',
    deleteWillRemove: 'This will permanently remove:',
    deleteItem1: 'Your account and login access',
    deleteItem2: 'All saved preferences and settings',
    deleteItem3: 'Your subscription and access history',
    deleteCannotUndo: 'This action cannot be undone.',
    confirmDelete: 'Yes, delete my account',
    cancel: 'Cancel',
    // General
    loading: 'Loading…',
  },
  es: {
    home: 'Inicio', locationWeather: 'Tiempo por ubicación', news: 'Noticias', graphics: 'Gráficos', newsletter: 'Boletín',
    settings: 'Ajustes', admin: 'Administrador',
    login: 'Iniciar sesión', logout: 'Cerrar sesión',
    activeWarnings: 'Alertas Activas', upcomingWarnings: 'Alertas Próximas',
    myWeatherGraphics: 'Gráficos MyWeather', tcmLightning: 'TCM Rayos',
    tcmOutlooks: 'Perspectivas TCM', liveRadar: 'Radar en Vivo',
    signIn: 'Iniciar sesión', signUp: 'Registrarse', signOut: 'Cerrar sesión',
    lightMode: 'Modo Claro', darkMode: 'Modo Oscuro',
    settingsTitle: 'Ajustes', manageAccount: 'Administra tu cuenta',
    yourAccount: 'Tu Cuenta', name: 'Nombre', email: 'Correo', role: 'Rol',
    units: 'Unidades de Medida', unitsDesc: 'Elige tus unidades preferidas — los cambios se aplican al instante',
    temperature: 'Temperatura', windSpeed: 'Velocidad del Viento', rainfall: 'Lluvia / Nieve', hail: 'Diámetro del Granizo',
    freeNewsletter: 'Boletín Gratuito', newsletterDesc: 'Perspectivas de tormentas, resúmenes y alertas — gratis para siempre',
    manageNewsletter: 'Gestionar suscripción al boletín',
    dangerZone: 'Zona de Peligro', dangerDesc: 'Acciones irreversibles — procede con cuidado',
    deleteAccount: 'Eliminar mi cuenta', deleteAccountDesc: 'Elimina permanentemente tu cuenta y todos los datos asociados. Esto no se puede deshacer.',
    deleting: 'Eliminando…',
    language: 'Idioma', languageDesc: 'Elige tu idioma de visualización preferido',
    deleteTitle: '¿Eliminar tu cuenta?',
    deleteWillRemove: 'Esto eliminará permanentemente:',
    deleteItem1: 'Tu cuenta y acceso de inicio de sesión',
    deleteItem2: 'Todas las preferencias y ajustes guardados',
    deleteItem3: 'Tu suscripción e historial de acceso',
    deleteCannotUndo: 'Esta acción no se puede deshacer.',
    confirmDelete: 'Sí, eliminar mi cuenta',
    cancel: 'Cancelar',
    loading: 'Cargando…',
  },
  pl: {
    home: 'Strona główna', locationWeather: 'Pogoda dla lokalizacji', news: 'Aktualności', graphics: 'Grafiki', newsletter: 'Newsletter',
    settings: 'Ustawienia', admin: 'Administrator',
    login: 'Zaloguj się', logout: 'Wyloguj się',
    activeWarnings: 'Aktywne Ostrzeżenia', upcomingWarnings: 'Nadchodzące Ostrzeżenia',
    myWeatherGraphics: 'Grafiki MyWeather', tcmLightning: 'TCM Błyskawice',
    tcmOutlooks: 'Prognozy TCM', liveRadar: 'Radar Na Żywo',
    signIn: 'Zaloguj się', signUp: 'Zarejestruj się', signOut: 'Wyloguj się',
    lightMode: 'Tryb Jasny', darkMode: 'Tryb Ciemny',
    settingsTitle: 'Ustawienia', manageAccount: 'Zarządzaj swoim kontem',
    yourAccount: 'Twoje konto', name: 'Imię', email: 'E-mail', role: 'Rola',
    units: 'Jednostki miary', unitsDesc: 'Wybierz preferowane jednostki — zmiany są natychmiastowe',
    temperature: 'Temperatura', windSpeed: 'Prędkość wiatru', rainfall: 'Opad / Śnieg', hail: 'Średnica gradu',
    freeNewsletter: 'Darmowy Newsletter', newsletterDesc: 'Tygodniowe prognozy burzowe, podsumowania i alerty — za darmo',
    manageNewsletter: 'Zarządzaj subskrypcją newslettera',
    dangerZone: 'Strefa Zagrożenia', dangerDesc: 'Nieodwracalne działania — postępuj ostrożnie',
    deleteAccount: 'Usuń moje konto', deleteAccountDesc: 'Trwale usuń swoje konto i wszystkie powiązane dane. Tej operacji nie można cofnąć.',
    deleting: 'Usuwanie…',
    language: 'Język', languageDesc: 'Wybierz preferowany język wyświetlania',
    deleteTitle: 'Usunąć Twoje konto?',
    deleteWillRemove: 'Zostanie trwale usunięte:',
    deleteItem1: 'Twoje konto i dostęp do logowania',
    deleteItem2: 'Wszystkie zapisane preferencje i ustawienia',
    deleteItem3: 'Twoja subskrypcja i historia dostępu',
    deleteCannotUndo: 'Tej operacji nie można cofnąć.',
    confirmDelete: 'Tak, usuń moje konto',
    cancel: 'Anuluj',
    loading: 'Ładowanie…',
  },
  zh: {
    home: '首页', locationWeather: '本地天气', news: '新闻', graphics: '图形', newsletter: '时事通讯',
    settings: '设置', admin: '管理员',
    login: '登录', logout: '登出',
    activeWarnings: '当前预警', upcomingWarnings: '即将发布的预警',
    myWeatherGraphics: 'MyWeather 图形', tcmLightning: 'TCM 闪电',
    tcmOutlooks: 'TCM 展望', liveRadar: '实时雷达',
    signIn: '登录', signUp: '注册', signOut: '退出',
    lightMode: '浅色模式', darkMode: '深色模式',
    settingsTitle: '设置', manageAccount: '管理您的账户',
    yourAccount: '您的账户', name: '姓名', email: '邮箱', role: '角色',
    units: '计量单位', unitsDesc: '选择您偏好的单位 — 更改即时生效',
    temperature: '温度', windSpeed: '风速', rainfall: '降雨 / 降雪', hail: '冰雹直径',
    freeNewsletter: '免费时事通讯', newsletterDesc: '每周风暴展望、模型摘要和警报 — 永久免费',
    manageNewsletter: '管理时事通讯订阅',
    dangerZone: '危险区域', dangerDesc: '不可逆操作 — 请谨慎操作',
    deleteAccount: '删除我的账户', deleteAccountDesc: '永久删除您的账户及所有相关数据，此操作不可撤销。',
    deleting: '删除中…',
    language: '语言', languageDesc: '选择您偏好的显示语言',
    deleteTitle: '删除您的账户？',
    deleteWillRemove: '这将永久删除：',
    deleteItem1: '您的账户和登录权限',
    deleteItem2: '所有已保存的偏好和设置',
    deleteItem3: '您的订阅和访问历史',
    deleteCannotUndo: '此操作不可撤销。',
    confirmDelete: '是的，删除我的账户',
    cancel: '取消',
    loading: '加载中…',
  },
  fr: {
    home: 'Accueil', locationWeather: 'Météo par lieu', news: 'Actualités', graphics: 'Graphiques', newsletter: 'Newsletter',
    settings: 'Paramètres', admin: 'Administrateur',
    login: 'Connexion', logout: 'Déconnexion',
    activeWarnings: 'Alertes Actives', upcomingWarnings: 'Alertes à Venir',
    myWeatherGraphics: 'Graphiques MyWeather', tcmLightning: 'TCM Foudre',
    tcmOutlooks: 'Prévisions TCM', liveRadar: 'Radar en Direct',
    signIn: 'Se connecter', signUp: "S'inscrire", signOut: 'Se déconnecter',
    lightMode: 'Mode Clair', darkMode: 'Mode Sombre',
    settingsTitle: 'Paramètres', manageAccount: 'Gérez votre compte',
    yourAccount: 'Votre Compte', name: 'Nom', email: 'E-mail', role: 'Rôle',
    units: 'Unités de mesure', unitsDesc: 'Choisissez vos unités préférées — les changements s\'appliquent instantanément',
    temperature: 'Température', windSpeed: 'Vitesse du vent', rainfall: 'Pluie / Neige', hail: 'Diamètre des grêlons',
    freeNewsletter: 'Newsletter gratuite', newsletterDesc: 'Perspectives hebdomadaires sur les orages, résumés et alertes — gratuitement',
    manageNewsletter: 'Gérer l\'abonnement à la newsletter',
    dangerZone: 'Zone Dangereuse', dangerDesc: 'Actions irréversibles — procédez avec prudence',
    deleteAccount: 'Supprimer mon compte', deleteAccountDesc: 'Supprimez définitivement votre compte et toutes les données associées. Cette action est irréversible.',
    deleting: 'Suppression…',
    language: 'Langue', languageDesc: 'Choisissez votre langue d\'affichage préférée',
    deleteTitle: 'Supprimer votre compte ?',
    deleteWillRemove: 'Cela supprimera définitivement :',
    deleteItem1: 'Votre compte et l\'accès à la connexion',
    deleteItem2: 'Toutes les préférences et paramètres enregistrés',
    deleteItem3: 'Votre abonnement et historique d\'accès',
    deleteCannotUndo: 'Cette action est irréversible.',
    confirmDelete: 'Oui, supprimer mon compte',
    cancel: 'Annuler',
    loading: 'Chargement…',
  },
  de: {
    home: 'Startseite', locationWeather: 'Wetter am Ort', news: 'Nachrichten', graphics: 'Grafiken', newsletter: 'Newsletter',
    settings: 'Einstellungen', admin: 'Administrator',
    login: 'Anmelden', logout: 'Abmelden',
    activeWarnings: 'Aktive Warnungen', upcomingWarnings: 'Bevorstehende Warnungen',
    myWeatherGraphics: 'MyWeather Grafiken', tcmLightning: 'TCM Blitz',
    tcmOutlooks: 'TCM Ausblicke', liveRadar: 'Live Radar',
    signIn: 'Anmelden', signUp: 'Registrieren', signOut: 'Abmelden',
    lightMode: 'Hellmodus', darkMode: 'Dunkelmodus',
    settingsTitle: 'Einstellungen', manageAccount: 'Konto verwalten',
    yourAccount: 'Ihr Konto', name: 'Name', email: 'E-Mail', role: 'Rolle',
    units: 'Maßeinheiten', unitsDesc: 'Wählen Sie Ihre bevorzugten Einheiten — Änderungen werden sofort übernommen',
    temperature: 'Temperatur', windSpeed: 'Windgeschwindigkeit', rainfall: 'Regen / Schnee', hail: 'Hagelkorndurchmesser',
    freeNewsletter: 'Kostenloser Newsletter', newsletterDesc: 'Wöchentliche Gewitterausblicke, Modellzusammenfassungen & Warnungen — kostenlos',
    manageNewsletter: 'Newsletter-Abonnement verwalten',
    dangerZone: 'Gefahrenzone', dangerDesc: 'Unwiderrufliche Aktionen — mit Vorsicht vorgehen',
    deleteAccount: 'Mein Konto löschen', deleteAccountDesc: 'Löschen Sie Ihr Konto und alle zugehörigen Daten dauerhaft. Dies kann nicht rückgängig gemacht werden.',
    deleting: 'Wird gelöscht…',
    language: 'Sprache', languageDesc: 'Wählen Sie Ihre bevorzugte Anzeigesprache',
    deleteTitle: 'Ihr Konto löschen?',
    deleteWillRemove: 'Folgendes wird dauerhaft entfernt:',
    deleteItem1: 'Ihr Konto und der Anmeldezugang',
    deleteItem2: 'Alle gespeicherten Einstellungen und Präferenzen',
    deleteItem3: 'Ihr Abonnement und der Zugriffsverlauf',
    deleteCannotUndo: 'Diese Aktion kann nicht rückgängig gemacht werden.',
    confirmDelete: 'Ja, mein Konto löschen',
    cancel: 'Abbrechen',
    loading: 'Laden…',
  },
};

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('mwuk_lang') || 'en');

  // Sync across tabs/windows when localStorage changes externally
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'mwuk_lang' && e.newValue && e.newValue !== lang) {
        setLang(e.newValue);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [lang]);

  const changeLang = (code) => {
    setLang(code);
    localStorage.setItem('mwuk_lang', code);
    // Broadcast to other open tabs
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'mwuk_lang', newValue: code, storageArea: localStorage,
    }));
  };

  const t = (key) => TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS.en[key] ?? key;

  return (
    <LanguageContext.Provider value={{ lang, changeLang, t, languages: LANGUAGES }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}