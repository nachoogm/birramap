{
  "bindings": [
    { "authLevel": "anonymous", "type": "httpTrigger", "direction": "in", "name": "req", "methods": ["get","post","delete"], "route": "checkin" },
    { "type": "http", "direction": "out", "name": "res" }
  ]
}
