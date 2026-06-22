# ECS task definition for the API service.
# To add a new env var to production:
#   1. Add secret to AWS Secrets Manager: prod/app
#   2. Add the secrets[] block below
#   3. PR this file — Atlantis applies on merge automatically

resource "aws_ecs_task_definition" "api" {
  family                   = "acmecorp-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_execution.arn

  container_definitions = jsonencode([
    {
      name  = "api"
      image = "${aws_ecr_repository.api.repository_url}:${var.image_tag}"

      portMappings = [{ containerPort = 8000, protocol = "tcp" }]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/acmecorp-api"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }

      # Secrets pulled from AWS Secrets Manager at task start.
      # Never put plaintext secrets in environment[].
      secrets = [
        { name = "DATABASE_URL",         valueFrom = "${aws_secretsmanager_secret.app.arn}:DATABASE_URL::" },
        { name = "DATABASE_URL_DIRECT",  valueFrom = "${aws_secretsmanager_secret.app.arn}:DATABASE_URL_DIRECT::" },
        { name = "CLERK_SECRET_KEY",     valueFrom = "${aws_secretsmanager_secret.app.arn}:CLERK_SECRET_KEY::" },
        { name = "ANTHROPIC_API_KEY",    valueFrom = "${aws_secretsmanager_secret.app.arn}:ANTHROPIC_API_KEY::" },
        { name = "LAUNCHDARKLY_SDK_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:LAUNCHDARKLY_SDK_KEY::" },
        { name = "TRIGGER_API_KEY",      valueFrom = "${aws_secretsmanager_secret.app.arn}:TRIGGER_API_KEY::" },
        { name = "REDIS_URL",            valueFrom = "${aws_secretsmanager_secret.app.arn}:REDIS_URL::" },
        { name = "SVIX_WEBHOOK_SECRET",  valueFrom = "${aws_secretsmanager_secret.app.arn}:SVIX_WEBHOOK_SECRET::" },
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT",     value = "8000" },
      ]
    }
  ])
}

resource "aws_secretsmanager_secret" "app" {
  name = "prod/app"
}

variable "aws_region" {
  default = "us-east-1"
}

variable "image_tag" {
  description = "Docker image tag to deploy"
}
