# Signing key

Drop the **public** key here as `fosslife-packages.asc` (ASCII-armored). The publish
workflow copies it to the Pages root so users can fetch it at
`https://fosslife.github.io/packages/fosslife-packages.asc`.

Export it from the keyring you generated:

```bash
gpg --armor --export zetabytes.pp@gmail.com > fosslife-packages.asc
```

⚠️ **Public key only.** Never commit the private key — it lives only in your keyring
and in the GitHub Actions secrets `GPG_PRIVATE_KEY` (base64) + `GPG_PASSPHRASE`.
