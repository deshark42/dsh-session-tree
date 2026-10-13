declare module '*.css?inline' {
  const css: string
  export default css
}
declare module '*.module.css?module' {
  export const stylesheet: string
  const classes: Record<string, string>
  export default classes
}
