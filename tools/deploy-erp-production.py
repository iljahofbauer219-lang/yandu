#!/usr/bin/env python3
"""仅发布现有 ERP 服务端；保留旧镜像、生产库及媒体备份，不提交 Git。
配置继承现有 Compose；只覆盖 app，不重启数据库或其他服务。
"""
import argparse
import hashlib
import io
import json
import pathlib
import shlex
import subprocess
import tarfile
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
SSH = ['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', 'root@114.55.149.192']
BASE = '/opt/yandu/app/docker-compose.yaml'


def remote(command, data=None, timeout=180):
    result = subprocess.run(SSH + [command], input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        if command.startswith('docker build '):
            print((result.stdout + result.stderr).decode(errors='replace')[-4000:], flush=True)
        # 不把可能携带配置值的原始输出写到用户报告。
        raise RuntimeError('远端步骤失败，退出码 ' + str(result.returncode))
    return result.stdout


def archive_file(archive, name, content):
    info = tarfile.TarInfo(name)
    info.size = len(content)
    info.mode = 0o600
    archive.addfile(info, io.BytesIO(content))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true', required=True)
    parser.parse_args()
    release_id = 'erp-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    dest = '/opt/yandu/releases/' + release_id
    output = ROOT / 'artifacts' / 'erp-production' / release_id
    output.mkdir(parents=True, exist_ok=False)
    record = {'release': release_id, 'remoteDirectory': dest, 'status': 'preparing', 'steps': []}
    def save(step):
        record['steps'].append(step)
        (output / 'deployment.json').write_text(json.dumps(record, ensure_ascii=False, indent=2))
        print(step, flush=True)
    try:
        deployed = json.loads(remote('docker inspect yandu-app'))[0]
        old_image = deployed['Image']
        assert deployed['Config']['Labels']['com.docker.compose.project'] == 'app'
        assert deployed['Config']['Labels']['com.docker.compose.service'] == 'app'
        compose = json.loads(remote('docker compose -p app -f ' + BASE + ' config --format json'))
        environment = compose['services']['app']['environment']
        assert environment.get('MEDIA_DRIVER', 'local') == 'local'
        assert environment.get('MEDIA_LOCAL_DIR') == '/app/data/media'
        assert environment.get('DATABASE_URL') and environment.get('JWT_SECRET')
        assert len(environment['JWT_SECRET']) >= 20
        assert any(m.get('Name') == 'app_media-data' for m in deployed['Mounts'])
        # 迁移历史校验：任何既有迁移缺失或被改写均中止。
        query = 'SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'
        js = 'const p=new (require("@prisma/client").PrismaClient)();p.$queryRawUnsafe(' + json.dumps(query) + ').then(r=>console.log(JSON.stringify(r))).finally(()=>p.$disconnect())'
        migrations = json.loads(remote('docker exec -w /app yandu-app node -e ' + shlex.quote(js)))
        local_migrations = ROOT / 'server/prisma/migrations'
        for migration in migrations:
            source = local_migrations / migration['migration_name'] / 'migration.sql'
            assert source.exists(), '生产存在本地未记录迁移，停止'
            assert hashlib.sha256(source.read_bytes()).hexdigest() == migration['checksum'], '既有迁移校验和不一致，停止'
        assert len(migrations) == 15, '生产迁移数量已变化，请重新核查'  # 2026-09-29 二次复核：首轮发布已应用 4 条新迁移（共 15）
        record['previousImage'] = old_image
        record['preExistingMigrations'] = len(migrations)
        save('生产容器、卷、配置和既有迁移校验通过')

        rollback_tag = 'yandu-erp:rollback-' + release_id
        release_tag = 'yandu-erp:' + release_id
        qdest = shlex.quote(dest)
        remote('umask 077; mkdir -p ' + qdest + '/backup ' + qdest + '/source; docker image tag ' + old_image + ' ' + rollback_tag)
        record['rollbackImage'] = rollback_tag
        remote('umask 077; docker exec yandu-db sh -c ' + shlex.quote('pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc') + ' > ' + qdest + '/backup/database.dump', timeout=600)
        remote('docker exec -i yandu-db pg_restore --list < ' + qdest + '/backup/database.dump', timeout=180)
        remote('umask 077; docker exec yandu-app tar -C /app/data/media -czf - . > ' + qdest + '/backup/media.tar.gz', timeout=600)
        remote('umask 077; tar --exclude=node_modules --exclude=dist -C /opt/yandu/app -czf ' + qdest + '/backup/server-config-source.tar.gz .', timeout=600)
        backup_sizes = remote('stat -c "%n %s bytes" ' + qdest + '/backup/*').decode().strip()
        record['backups'] = backup_sizes.splitlines()
        record['backupValidation'] = 'pg_restore --list 通过；未执行完整恢复演练'
        save('已保留旧镜像、数据库自定义格式备份、媒体卷及原服务配置')

        package = io.BytesIO()
        with tarfile.open(fileobj=package, mode='w:gz') as archive:
            for directory in ['src', 'prisma']:
                for path in sorted((ROOT / 'server' / directory).rglob('*')):
                    if path.is_file() and '__tests__' not in path.parts:
                        archive.add(path, arcname=str(path.relative_to(ROOT / 'server')))
            for name in ['tsconfig.json', 'scripts/migrate-erp-roles.ts']:
                archive.add(ROOT / 'server' / name, arcname=name)
            manifest = json.loads((ROOT / 'server/package.json').read_text())
            lock = json.loads((ROOT / 'server/package-lock.json').read_text())
            # 本地 npm 锁含指向 workspace .pnpm 的 link，不能搬到独立容器。
            # 固定当前已验证的直接依赖版本，在干净目录生成可移植的完整锁。
            for group in ['dependencies', 'devDependencies']:
                for name in list(manifest[group]):
                    if name in ['@electric-sql/pglite', '@electric-sql/pglite-socket']:
                        del manifest[group][name]
                        continue
                    entry = lock['packages']['node_modules/' + name]
                    if entry.get('link'):
                        entry = lock['packages'][entry['resolved']]
                    manifest[group][name] = entry['version']
            record['deploymentDependencies'] = manifest['dependencies']
            record['deploymentBuildDependencies'] = manifest['devDependencies']
            archive_file(archive, 'package.json', json.dumps(manifest, indent=2).encode())
            # 沿用正在工作的系统运行时；新源码、依赖和构建隔离在 /erp。
            dockerfile = f'''FROM {rollback_tag}
WORKDIR /erp
COPY package.json ./
RUN npm install --package-lock-only --include=dev --ignore-scripts --registry=https://registry.npmmirror.com && npm ci --include=dev --registry=https://registry.npmmirror.com
COPY . .
RUN ./node_modules/.bin/prisma generate && npm run build
EXPOSE 8787
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/src/index.js"]
'''
            archive_file(archive, 'Dockerfile', dockerfile.encode())
            archive_file(archive, '.dockerignore', b'.env\n.env.*\nnode_modules\ndist\n')
        content = package.getvalue()
        record['sourceArchiveSha256'] = hashlib.sha256(content).hexdigest()
        remote('tar -xzf - -C ' + qdest + '/source', data=content)
        save('发布源码已上传，未上传本地环境文件、密钥、用户数据或 mock 验证脚本')
        build = remote('docker build -t ' + release_tag + ' ' + qdest + '/source', timeout=1200)
        record['image'] = release_tag
        record['imageId'] = remote('docker image inspect --format "{{.Id}}" ' + release_tag).decode().strip()
        lock_bytes = remote('docker run --rm --entrypoint node ' + release_tag + ' -e ' + shlex.quote('process.stdout.write(require("fs").readFileSync("/erp/package-lock.json","utf8"))'))
        (output / 'deployed-package-lock.json').write_bytes(lock_bytes)
        record['deployedLockSha256'] = hashlib.sha256(lock_bytes).hexdigest()
        save('可移植锁文件安装、Prisma Client 生成和服务端构建通过')

        # API 仍通过原代理服务；仅签名媒体使用已有公网 HTTP 入口，TLS 限制单列报告。
        overlay = {'services': {'app': {'image': release_tag, 'working_dir': '/erp', 'environment': {
            'MEDIA_PUBLIC_BASE_URL': 'http://114.55.149.192', 'ERP_PATROL_ENABLED': 'false'
        }}}}
        upload = io.BytesIO()
        with tarfile.open(fileobj=upload, mode='w:gz') as archive:
            archive_file(archive, 'compose.erp.json', json.dumps(overlay).encode())
            archive_file(archive, 'compose.rollback.json', json.dumps({'services': {'app': {'image': rollback_tag}}}).encode())
        remote('tar -xzf - -C ' + qdest, data=upload.getvalue())
        command = 'docker compose -p app -f ' + BASE + ' -f ' + dest + '/compose.erp.json'
        rollback_command = 'docker compose -p app -f ' + BASE + ' -f ' + dest + '/compose.rollback.json up -d --no-deps --no-build app'
        record['composeCommand'] = command
        record['rollbackCommand'] = rollback_command
        remote(command + ' run --rm --no-deps app ./node_modules/.bin/prisma migrate deploy', timeout=300)
        save('生产数据库 ERP 增量迁移执行成功')
        roles = remote(command + ' run --rm --no-deps app node dist/scripts/migrate-erp-roles.js', timeout=180).decode().strip()
        record['roleMigration'] = roles
        save('既有组织角色权限补齐完成')
        remote(command + ' up -d --no-deps --no-build app', timeout=180)
        try:
            health_js = '''async function check(){for(let i=0;i<30;i++){try{const a=await fetch("http://127.0.0.1:8787/health");const b=await fetch("http://127.0.0.1:8787/api/erp/products");const c=await fetch("http://127.0.0.1:8787/api/auth/me");if(a.status===200&&b.status===401&&c.status===401){console.log("health=200 erp=401 auth=401");return}}catch{}await new Promise(r=>setTimeout(r,1000))}process.exit(1)}check()'''
            probe = remote('docker exec yandu-app node -e ' + shlex.quote(health_js), timeout=60).decode().strip()
            record['readiness'] = probe
        except Exception:
            remote(rollback_command, timeout=180)
            record['status'] = 'rolled_back'
            save('基础健康检查失败，已回切旧镜像，保留新增兼容表，不回滚生产数据')
            raise
        record['status'] = 'deployed_pending_business_verification'
        record['finishedAt'] = datetime.now(timezone.utc).isoformat()
        save('仅业务容器已更新，健康与鉴权路由检查通过，等待真实业务及客户端验证')
        print('部署记录：' + str(output / 'deployment.json'), flush=True)
    except Exception as error:
        if record['status'] != 'rolled_back':
            record['status'] = 'stopped'
        record['errorType'] = type(error).__name__
        record['errorCode'] = str(error) if isinstance(error, (AssertionError, RuntimeError)) else type(error).__name__
        (output / 'deployment.json').write_text(json.dumps(record, ensure_ascii=False, indent=2))
        print('部署中止，详见脱敏部署记录；未自动重试。', flush=True)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
