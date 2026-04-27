# Publicar Agenda Web con Supabase y Vercel

## 1. Supabase

1. Crea un proyecto en Supabase.
2. Entra a SQL Editor.
3. Copia y ejecuta el contenido de `supabase/schema.sql`.
4. Ve a Project Settings > API y copia:
   - Project URL
   - Publishable key
5. Ve a Authentication > URL Configuration.
6. En Site URL usa tu dominio de Vercel cuando lo tengas, por ejemplo:
   - `https://tu-agenda.vercel.app`
7. En Redirect URLs agrega:
   - `http://localhost:3000`
   - `https://tu-agenda.vercel.app`

## 2. Local

Crea `.env.local` en la raiz de `agenda-web`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=tu_publishable_key
```

Luego ejecuta:

```powershell
npm.cmd run dev
```

## 3. Vercel

1. Sube el proyecto a GitHub.
2. En Vercel, importa el repositorio.
3. Si Vercel detecta la carpeta raiz incorrecta, selecciona `agenda-web` como Root Directory.
4. En Settings > Environment Variables agrega:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
5. Deploy.

## 4. Uso

Abre la URL de Vercel desde PC o celular, inicia sesion con tu correo y revisa el enlace que llega por email.
Tus notas quedaran guardadas en Supabase y se veran desde cualquier dispositivo donde entres con el mismo correo.
