// validate(zodSchema) -> parses req.body, replaces it with the clean version
export const validate = (schema) => (req, res, next) => {
  req.body = schema.parse(req.body ?? {})
  next()
}
