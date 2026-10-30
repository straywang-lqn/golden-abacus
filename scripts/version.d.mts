/** 供 TypeScript 构建配置复用现有版本解析器；返回值已校验为合法 Android 版本。 */
export function readAndroidVersion(source: string): { versionCode: number; versionName: string }
