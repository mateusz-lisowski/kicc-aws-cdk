import aws_cdk as core
import aws_cdk.assertions as assertions

from kicc_aws.kicc_aws_stack import KiccAwsStack

# example tests. To run these tests, uncomment this file along with the example
# resource in kicc_aws/kicc_aws_stack.py
def test_sqs_queue_created():
    app = core.App()
    stack = KiccAwsStack(app, "kicc-aws")
    template = assertions.Template.from_stack(stack)

#     template.has_resource_properties("AWS::SQS::Queue", {
#         "VisibilityTimeout": 300
#     })
