# Configuration d'Atlas (édition communautaire, licence Apache 2).
# L'adresse de la base est lue dans la variable ATLAS_DATABASE_URL : jamais en argument de
# commande, où elle serait visible dans la liste des processus avec son mot de passe.
env "sabou" {
  url = getenv("ATLAS_DATABASE_URL")
  migration {
    dir = "file:///migrations"
  }
}
