# Oracle Cloud Free — VM para Icecast (StreamServer)

Guia passo a passo para criar uma VM **Always Free** na Oracle Cloud e instalar o Icecast para o BUTT transmitir.

Tempo estimado: **20–40 minutos** (conta nova pode demorar mais na verificação).

---

## O que vais obter

| Item | Valor |
|------|-------|
| VM | Ubuntu 22.04 (Always Free) |
| Icecast | Porta **8000** (HTTP) |
| Custo | **0 €/mês** (tier Always Free) |
| BUTT liga a | `IP_PUBLICO:8000` |
| Ouvintes ouvem em | `https://stream-server-rouge.vercel.app/stream/...` |

---

## Parte 1 — Criar conta Oracle Cloud

1. Abre [https://www.oracle.com/cloud/free/](https://www.oracle.com/cloud/free/) e clica **Start for free**.
2. Preenche email, país, nome. Escolhe **Home Region** — **não podes mudar depois**. Sugestão para Angola/Europa: **Germany Central (Frankfurt)** ou **UK South (London)**.
3. Confirma email e telefone (SMS).
4. Cartão de crédito — Oracle pede para verificação; **não cobra** se ficares no Always Free (podes definir budget alerts).

---

## Parte 2 — Criar a VM (Compute Instance)

1. Entra no [Oracle Cloud Console](https://cloud.oracle.com/).
2. Menu ☰ → **Compute** → **Instances** → **Create instance**.

### Nome e imagem

| Campo | Valor |
|-------|-------|
| **Name** | `streamserver-icecast` |
| **Compartment** | (root) |
| **Placement** | Deixa o default; se der *Out of capacity*, muda **Availability Domain** |

Em **Image and shape**:

3. Clica **Change image** → **Canonical Ubuntu** → **Ubuntu 22.04** → **Select image**.
4. Clica **Change shape**:
   - **Ampere** → **VM.Standard.A1.Flex** → 1 OCPU, 6 GB RAM (Always Free)  
   - Se Ampere não estiver disponível: **AMD** → **VM.Standard.E2.1.Micro** (Always Free, mais limitado).

### Rede e IP público

5. **Primary VNIC** → **Public IPv4 address**: **Assign a public IPv4 address** ✅ (obrigatório).

### Chave SSH

6. Em **Add SSH keys**, escolhe **Generate a key pair for me**:
   - Clica **Save private key** → guarda `ssh-key-YYYY-MM-DD.key` num sítio seguro.
   - Clica **Save public key** (opcional).

7. Clica **Create**.

8. Aguarda estado **Running** (1–3 min). Anota o **Public IP address** (ex: `123.45.67.89`).

> **Erro "Out of host capacity"** — comum no Ampere Free. Tenta: outro Availability Domain, outra região (nova conta), ou shape **E2.1.Micro** AMD.

---

## Parte 3 — Abrir portas no firewall Oracle (Security List)

Por defeito só a porta 22 (SSH) pode estar aberta. Precisas da **8000** para Icecast/BUTT.

1. Na página da instância, clica no **Subnet link** (ex: `subnet-20260101...`).
2. Clica na **Security List** (default).
3. **Add Ingress Rules**:

| Campo | Valor |
|-------|-------|
| Source CIDR | `0.0.0.0/0` |
| IP Protocol | TCP |
| Destination Port | `22` |
| Description | SSH |

(Regra 22 muitas vezes já existe.)

4. **Add Ingress Rules** outra vez:

| Campo | Valor |
|-------|-------|
| Source CIDR | `0.0.0.0/0` |
| IP Protocol | TCP |
| Destination Port | `8000` |
| Description | Icecast BUTT + proxy Render |

5. Guarda.

---

## Parte 4 — Ligar por SSH (do teu PC)

No Mac/Linux (substitui IP e caminho da chave):

```bash
chmod 600 ~/Downloads/ssh-key-2026-01-01.key
ssh -i ~/Downloads/ssh-key-2026-01-01.key ubuntu@SEU_IP_PUBLICO
```

No Windows: usa **PuTTY** (converte `.key` para `.ppk`) ou **Windows Terminal** com OpenSSH.

Primeira ligação: responde `yes` ao fingerprint.

---

## Parte 5 — Instalar Icecast na VM (automático)

### Opção A — Clone do repositório (se tiveres GitHub)

```bash
sudo apt-get update -y
sudo apt-get install -y git
git clone https://github.com/TEU_USER/StreamServer.git
cd StreamServer
chmod +x scripts/oracle-cloud-bootstrap.sh
./scripts/oracle-cloud-bootstrap.sh
```

### Opção B — Copiar só os ficheiros necessários (sem Git)

No **teu PC** (na pasta do projecto StreamServer):

```bash
scp -i ~/Downloads/ssh-key-2026-01-01.key -r \
  infrastructure/icecast \
  scripts/setup-icecast-vm.sh \
  scripts/oracle-cloud-bootstrap.sh \
  ubuntu@SEU_IP_PUBLICO:~/streamserver/
```

Na **VM**:

```bash
cd ~/streamserver
chmod +x oracle-cloud-bootstrap.sh setup-icecast-vm.sh
./oracle-cloud-bootstrap.sh SEU_IP_PUBLICO
```

O script instala Docker, arranca Icecast e mostra as variáveis para o **Render**.

---

## Parte 6 — Testar Icecast

No **teu PC**:

```bash
curl http://SEU_IP_PUBLICO:8000/status-json.xsl
```

Deves ver JSON com `"icestats"`. Se der timeout:

- Confirma regra **8000** na Security List (Parte 3).
- Na VM: `sudo docker ps` — container `streamserver-icecast` deve estar `Up`.
- Na VM: `curl localhost:8000/status-json.xsl` — se funcionar localmente mas não de fora, é firewall Oracle.

---

## Parte 7 — Configurar o Render

Render → serviço **streamserver-api** → **Environment** → adiciona (usa o IP da VM):

```
ICECAST_DISABLED=false
PUBLIC_ICECAST_HOST=SEU_IP_PUBLICO
ICECAST_HOST=SEU_IP_PUBLICO
ICECAST_PORT=8000
ICECAST_ADMIN_USER=admin
ICECAST_ADMIN_PASSWORD=<admin-password impressa pelo script>
```

**Manual Deploy** / redeploy do serviço.

Valida:

```bash
curl https://streamserver-ivu7.onrender.com/api/health
```

Esperado: `"icecast": "ok"` e `"icecastConfigured": true`.

---

## Parte 8 — Configurar o BUTT

| Campo | Valor |
|-------|-------|
| Tipo | Icecast |
| **Servidor** | `SEU_IP_PUBLICO` (só o IP, sem `https://`) |
| Porta | `8000` |
| Mount | `/radio-chipcity/live` (ou o da tua estação) |
| Utilizador | `source` |
| Password | credencial da estação no dashboard |
| SSL/TLS | **Desligado** |

URL para ouvir (inalterada):

`https://stream-server-rouge.vercel.app/stream/radio-chipcity/live`

---

## Problemas comuns (Oracle)

| Problema | Solução |
|----------|---------|
| Out of capacity | Outro AD, shape E2.1.Micro, ou tentar noutro dia |
| SSH timeout | IP público assignado? Security List porta 22? |
| Icecast timeout externo | Security List porta **8000** |
| BUTT "Error resolving server address" | Servidor = só IP/hostname, **sem** `https://` ou `/` |
| BUTT conecta mas cai | Password ou mount errados; subscrição inactiva |
| `/stream/...` dá 502 | Render sem `ICECAST_HOST` ou Icecast parado |
| VM parada sozinha | Oracle Free pode reclamar instâncias ociosas — mantém tráfego ou reinicia |

---

## Comandos úteis na VM

```bash
# Estado do container
docker ps
docker compose -f ~/streamserver-icecast/docker-compose.yml logs -f icecast

# Reiniciar Icecast
cd ~/streamserver-icecast && docker compose restart

# IP público (se esqueceres)
curl -s ifconfig.me && echo
```

---

## Próximo passo opcional: domínio

Em vez do IP no BUTT, podes criar `icecast.teudominio.com` → registo **A** apontando para o IP público e usar esse nome em `PUBLIC_ICECAST_HOST`.

---

## Checklist final

- [ ] VM Running com IP público
- [ ] Security List: TCP 22 + 8000
- [ ] `curl http://IP:8000/status-json.xsl` OK
- [ ] Render: `PUBLIC_ICECAST_HOST` + redeploy
- [ ] `/api/health` → icecast ok
- [ ] BUTT: servidor = IP, porta 8000, SSL off
- [ ] Stream online em `/stream/...`
