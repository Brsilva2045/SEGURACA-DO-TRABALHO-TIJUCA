# SST EPI Firebase Next.js

Estrutura gerada para separar a integração Firebase em um projeto Next.js.

## Pastas principais

- `src/app` - App Router do Next.js
- `src/components/ui` - primitives de UI usados pelo painel
- `src/lib/firebase` - Auth, Firestore, Storage e wrappers de Cloud Functions
- `functions` - Cloud Functions do Firebase

## Componentes-chave

- `src/app/page.jsx` renderiza o painel principal
- `src/components/SSTEpiFirebaseMVP.jsx` reexporta o painel existente
- `src/lib/firebase/index.js` expõe `firebaseApi` para o painel
- `functions/index.js` traz triggers e callables do backend

## Variáveis de ambiente

Copie `.env.local.example` para `.env.local` e preencha os valores do Firebase.

## Execução

1. Instale as dependências no diretório raiz.
2. Rode `npm run dev` para o Next.js.
3. Instale dependências dentro de `functions/` se for trabalhar com Cloud Functions localmente.
