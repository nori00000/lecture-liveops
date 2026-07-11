[English](README.md) | [한국어](README.ko.md)

[English](README.md) | [한국어](README.ko.md)

<div align="center">

# lecture-liveops

![hero](assets/hero.png)

lecture-liveops — a project.

![License](https://img.shields.io/badge/License-MIT-yellow.svg) ![Status](https://img.shields.io/badge/status-active-brightgreen.svg) ![Maintained](https://img.shields.io/badge/maintained-yes-success.svg) ![PRs](https://img.shields.io/badge/PRs-welcome-blueviolet.svg) ![Made%20with](https://img.shields.io/badge/made%20with-%E2%9D%A4-red.svg) ![Node](https://img.shields.io/badge/node-%3E%3D18-339933.svg) ![npm](https://img.shields.io/badge/npm-package-CB3837.svg) ![Conventional%20Commits](https://img.shields.io/badge/commits-conventional-FE5196.svg)

</div>

---

## 🌟 Highlights

- ⚡ **lecture-liveops** — lecture-liveops — a project.
- 🧩 type: `node` 프로젝트, 한 번에 셋업.
- 🔒 안전 기본값 — 시크릿 누출 차단, private 문서 분리.
- 📈 Conventional Commits + 자동 CHANGELOG + semver 릴리스.

## 🚀 Quick Start

```bash
git clone https://github.com/Son/lecture-liveops.git
cd lecture-liveops
make init        # 또는 프로젝트 진입점 실행
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](.github/SECURITY.md), and [SUPPORT.md](.github/SUPPORT.md) for project documentation.

## 📸 Gallery

| | | |
|---|---|---|
| ![g1](assets/gallery-1.png) | ![g2](assets/gallery-2.png) | ![g3](assets/gallery-3.png) |

## 📊 Architecture

```mermaid
flowchart LR
  A[Input] --> B[lecture-liveops core]
  B --> C[Gates / QA]
  C -->|pass| D[Output]
  C -->|fail| B
```

![architecture](assets/architecture.png)

## 🤝 Contributing

이슈와 PR을 환영합니다. [PULL_REQUEST_TEMPLATE](.github/PULL_REQUEST_TEMPLATE.md) 와 [SECURITY](.github/SECURITY.md) 를 확인하세요.

## 📝 License

MIT © 2026 Son — [LICENSE](LICENSE)
