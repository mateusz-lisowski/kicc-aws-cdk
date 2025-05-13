from aws_cdk import (
    Duration,
    Stack,
    aws_lambda as _lambda,
    CfnOutput,
    aws_s3 as s3,
    aws_apigateway as apigateway,
    aws_ec2 as ec2,
    RemovalPolicy
)
from constructs import Construct


class KiccAwsStack(Stack):

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # 1. S3 Bucket for storing files
        file_bucket = s3.Bucket(
            self, "FileStorageBucket",
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            versioned=False,
            encryption=s3.BucketEncryption.S3_MANAGED,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            enforce_ssl=True,
            cors=[
                s3.CorsRule(
                    allowed_methods=[s3.HttpMethods.GET, s3.HttpMethods.POST, s3.HttpMethods.PUT, s3.HttpMethods.DELETE, s3.HttpMethods.HEAD],
                    allowed_origins=["*"],
                    allowed_headers=["*"], 
                    exposed_headers=["ETag", "x-amz-request-id"]
                )
            ]
        )

        # Define the Lambda function resource
        file_manager_lambda = _lambda.Function(
            self, "FileManagerFunction",
            runtime=_lambda.Runtime.NODEJS_20_X,
            handler="index.handler",
            code=_lambda.Code.from_asset("kicc_aws/lambda_handler"),
            environment={
                "BUCKET_NAME": file_bucket.bucket_name
            },
            timeout=Duration.seconds(30)
        )

        # Grant the Lambda function read/write permissions to the S3 bucket
        file_bucket.grant_read_write(file_manager_lambda)

        # 3. API Gateway to expose the Lambda function
        api = apigateway.LambdaRestApi(
            self, "FileManagerApi",
            handler=file_manager_lambda,
            proxy=False,
            default_cors_preflight_options=apigateway.CorsOptions(
                allow_origins=apigateway.Cors.ALL_ORIGINS,
                allow_methods=apigateway.Cors.ALL_METHODS
            )
        )

        # Define API Gateway resources and methods
        root_resource = api.root
        root_resource.add_method("GET")

        get_upload_url_resource = root_resource.add_resource("get-upload-url")
        get_upload_url_resource.add_method("POST")

        get_download_url_resource = root_resource.add_resource("get-download-url")
        get_download_url_resource.add_method("POST")

        # 4. EC2 Instance (VPS)
        vpc = ec2.Vpc.from_lookup(self, "VPC", is_default=True)

        # Define a security group for the EC2 instance
        web_sg = ec2.SecurityGroup(
            self, 
            "WebInstanceSG",
            vpc=vpc,
            description="Allow SSH and HTTP/HTTPS",
            allow_all_outbound=True
        )

        web_sg.add_ingress_rule(ec2.Peer.any_ipv4(), ec2.Port.tcp(22), "Allow SSH from anywhere (TCP port 22)")
        web_sg.add_ingress_rule(ec2.Peer.any_ipv4(), ec2.Port.tcp(80), "Allow HTTP traffic from anywhere (TCP port 80)")
        web_sg.add_ingress_rule(ec2.Peer.any_ipv4(), ec2.Port.tcp(443), "Allow HTTPS traffic from anywhere (TCP port 443)")
        web_sg.add_ingress_rule(ec2.Peer.any_ipv4(), ec2.Port.tcp(8080), "Allow Jenkins frontend port")

        # Define the EC2 instance
        ec2_instance = ec2.Instance(
            self, "MyVPS",
            vpc=vpc,
            instance_type=ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
            machine_image=ec2.MachineImage.latest_amazon_linux2023(),
            security_group=web_sg,
        )

        # CloudFormation outputs
        CfnOutput(self, "BucketName", value=file_bucket.bucket_name)
        CfnOutput(self, "ApiGatewayUrl", value=api.url)
        CfnOutput(self, "Ec2InstancePublicDnsName", value=ec2_instance.instance_public_dns_name)
        CfnOutput(self, "Ec2InstancePublicIp", value=ec2_instance.instance_public_ip)
