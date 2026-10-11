# Instalar

O Coxia é um aplicativo de desktop para Linux, macOS e Windows, com um companheiro no celular que
você abre no navegador. Hoje ele é construído e rodado a partir do código.

```bash
nvm use                 # a versão do Node que está no .nvmrc
npm ci
npm run dev             # Electron com recarga automática
```

A preparação é a do próprio repositório e fica num só lugar: leia o
[CONTRIBUTING.md](https://github.com/exatasmente/coxia/blob/main/CONTRIBUTING.md) no repositório
para a versão do Node, o sidecar de voz opcional e a pasta de dados descartável para desenvolver.

**O que você deve ver:** a janela do aplicativo abrindo na tela Hoje, ainda sem nada. O próximo
passo aponta o aplicativo para um repositório.

<!-- site:image-placeholder -->
> **Captura (pendente).** A tela Hoje de uma instalação nova. Sai do aplicativo, de um espaço de
> trabalho semeado com dados fictícios, refeita a cada versão.
