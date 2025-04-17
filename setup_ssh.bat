@echo off
echo 删除旧的 SSH 密钥...
del /q "%USERPROFILE%\.ssh\id_ed25519" 2>nul
del /q "%USERPROFILE%\.ssh\id_ed25519.pub" 2>nul

echo 生成新的 SSH 密钥...
ssh-keygen -t ed25519 -C "your_email@example.com" -f "%USERPROFILE%\.ssh\id_ed25519" -N ""

echo 确保 SSH agent 运行...
start "" "C:\Windows\System32\OpenSSH\ssh-agent.exe"

echo 添加密钥到 SSH agent...
ssh-add "%USERPROFILE%\.ssh\id_ed25519"

echo 复制公钥到剪贴板...
type "%USERPROFILE%\.ssh\id_ed25519.pub" | clip

echo.
echo SSH 密钥已生成并复制到剪贴板！
echo 请将公钥添加到 GitHub：
echo 1. 登录 GitHub
echo 2. 点击右上角头像 -> Settings
echo 3. 点击左侧 "SSH and GPG keys"
echo 4. 点击 "New SSH key"
echo 5. 给密钥起个名字，并粘贴剪贴板中的内容
echo 6. 点击 "Add SSH key"
echo.
pause