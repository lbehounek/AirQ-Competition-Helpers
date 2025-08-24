# 🌍 Internationalization (i18n) System

This project uses a custom, lightweight i18n system built with React Context that perfectly matches your existing architecture.

## 🏗️ **Architecture**

```
frontend/src/
├── locales/                  ← Translation files
│   ├── en.json              ← English (default)
│   ├── cs.json              ← Czech
│   ├── index.ts             ← Types & exports
│   └── README.md            ← This file
├── contexts/
│   └── I18nContext.tsx      ← Translation context
└── components/
    └── LanguageSwitcher.tsx ← Language selector
```

## 📝 **Usage Examples**

### Basic Translation
```tsx
import { useI18n } from '../contexts/I18nContext';

function MyComponent() {
  const { t } = useI18n();
  
  return (
    <Typography variant="h1">
      {t('app.title')} {/* → "Photo Helper" or "Foto Pomocník" */}
    </Typography>
  );
}
```

### Translation with Parameters
```tsx
const { t } = useI18n();

return (
  <Typography>
    {t('sets.title.placeholder', { setName: 'Set 1' })}
    {/* → "Enter title for Set 1..." or "Zadejte název pro Set 1..." */}
  </Typography>
);
```

### Get Current Language
```tsx
const { locale, setLocale } = useI18n();

console.log(locale); // → "en" or "cs"
setLocale('cs'); // Switch to Czech
```

## 🔤 **Translation Keys Structure**

```json
{
  "app": {
    "title": "Photo Helper",
    "subtitle": "Organize your navigation flight photos..."
  },
  "photoFormat": {
    "title": "Photo Format:",
    "aspectRatios": {
      "3:2": { "name": "3:2", "description": "Standard" }
    }
  },
  "actions": {
    "generatePdf": "Generate PDF",
    "resetSession": "Reset Session",
    "shuffle": {
      "name": "Shuffle", 
      "description": "Randomize order"
    }
  }
}
```

## ➕ **Adding New Languages**

1. **Create new translation file:**
   ```bash
   # Add German support
   touch frontend/src/locales/de.json
   ```

2. **Add translations:**
   ```json
   // de.json
   {
     "app": {
       "title": "Foto Helfer",
       "subtitle": "Organisieren Sie Ihre Navigationsflug-Fotos..."
     }
     // ... rest of translations
   }
   ```

3. **Update `locales/index.ts`:**
   ```typescript
   import de from './de.json';
   
   export type Locale = 'en' | 'cs' | 'de';
   
   export const locales = { en, cs, de } as const;
   
   export const SUPPORTED_LOCALES = [
     { code: 'en', name: 'English', flag: '🇺🇸' },
     { code: 'cs', name: 'Čeština', flag: '🇨🇿' },
     { code: 'de', name: 'Deutsch', flag: '🇩🇪' }
   ];
   ```

## ➕ **Adding New Translation Keys**

1. **Add to all language files:**
   ```json
   // en.json
   { "myNew": { "feature": "My New Feature" } }
   
   // cs.json  
   { "myNew": { "feature": "Má nová funkce" } }
   ```

2. **Use in components:**
   ```tsx
   const { t } = useI18n();
   return <Typography>{t('myNew.feature')}</Typography>;
   ```

## 🎯 **Best Practices**

### ✅ **DO:**
- Use descriptive, hierarchical keys: `photoFormat.aspectRatios.3:2.name`
- Add translations for ALL supported languages when adding new keys
- Use parameters for dynamic content: `{{ count }} photos`
- Group related translations: `actions.shuffle.name`, `actions.shuffle.description`

### ❌ **DON'T:**
- Use translation keys as user-facing text: `t('photoFormat.title')` ✅ vs `"photoFormat.title"` ❌
- Leave translations incomplete in some languages
- Use complex nested parameters - keep it simple
- Hardcode text directly in components

## 🔄 **Language Persistence**

Languages are automatically saved to localStorage:
```
localStorage.setItem('app-locale', 'cs')
```

On app restart, the last selected language is restored.

## 🎨 **Language Switcher**

The `LanguageSwitcher` component provides a card-based UI matching your app's design:

```tsx
import { LanguageSwitcher } from './components/LanguageSwitcher';

// Use anywhere in your app
<LanguageSwitcher />
```

Features:
- Visual feedback for selected language
- Flag emojis for easy recognition
- Consistent styling with other selectors
- Hover effects and transitions

## 🛠️ **Implementation Details**

- **Context-based**: Matches your existing `AspectRatioContext` and `LabelingContext` pattern
- **Type-safe**: Full TypeScript support with proper type inference
- **Lightweight**: No external dependencies
- **Fast**: Instant language switching with local state management
- **Flexible**: Support for parameterized translations with `{{placeholder}}` syntax

## 🚀 **Performance**

- All translations loaded on app start (small file sizes)
- No async loading - instant language switches
- Minimal re-renders through React context optimization
- Persistent language selection via localStorage
