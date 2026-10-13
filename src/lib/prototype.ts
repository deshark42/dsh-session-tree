/** Copy a version-checked adapter onto the shared runtime's existing objects. */
export function extendPrototype(target: object, implementation: object): void {
  const descriptors = Object.getOwnPropertyDescriptors(implementation)
  Reflect.deleteProperty(descriptors, 'constructor')
  Object.defineProperties(target, descriptors)
}
