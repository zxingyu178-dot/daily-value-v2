/**
 * Daily Value v2 - 迁移注册入口
 * 应用启动（main.ts）引入本模块，注册实际 v1 → v2 迁移步骤。
 * 引入本模块是副作用导入（副作用：registerMigration）。
 */
import { registerMigration } from '@/core/migration/manager';
import { v1ToV2Migration } from '@/core/migration/migrations/v1-to-v2';

registerMigration(v1ToV2Migration);
